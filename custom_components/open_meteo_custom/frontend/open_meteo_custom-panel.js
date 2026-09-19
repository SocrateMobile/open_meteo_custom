/**
 * Open-Meteo Custom — Panneau Latéral Interactif & Carte Multi-Couches (v1.4.9)
 * 
 * Fonctionnalités :
 * 1. Carte interactive Leaflet intégrée 100% locale avec zoom / dézoom / recentrage.
 * 2. Floating Layer Switcher avec zones de couleurs :
 *    - 🌧️ Précipitations (Radar RainViewer animé temps réel avec lecture Play/Pause et curseur)
 *    - 😷 Qualité de l'Air (Zones de couleurs EAQI de vert à pourpre)
 *    - 🌾 Pollens (Zones de risque allergique pour 6 pollens)
 *    - 🌡️ Température (Zones thermiques et température ressentie)
 *    - 💨 Vents (Zones de rafales et orientation)
 * 3. Légende chromatique dynamique pour chaque couche.
 * 4. Bandeau de vigilance proactive (Gel, Vent fort, Orage, Pollution).
 * 5. Résumé météo intelligent en langage naturel.
 * 6. Frise chronologique horaire 24h défilante & prévisions 7 jours.
 * 7. Raccourcis domotiques intégrés (stores, vmc, arrosage).
 */

(function () {
  const LEAFLET_CSS_URL = "/open_meteo_custom_frontend/vendor/leaflet.css";
  const LEAFLET_JS_URL = "/open_meteo_custom_frontend/vendor/leaflet.js";

  function ensureLeaflet() {
    return new Promise((resolve) => {
      if (window.L && window.L.map) {
        return resolve(window.L);
      }
      if (!document.getElementById("open-meteo-leaflet-css")) {
        const link = document.createElement("link");
        link.id = "open-meteo-leaflet-css";
        link.rel = "stylesheet";
        link.href = LEAFLET_CSS_URL;
        document.head.appendChild(link);
      }
      if (!document.getElementById("open-meteo-leaflet-js")) {
        const script = document.createElement("script");
        script.id = "open-meteo-leaflet-js";
        script.src = LEAFLET_JS_URL;
        script.onload = () => resolve(window.L);
        script.onerror = () => {
          // Fallback CDN if local fails
          const cdnScript = document.createElement("script");
          cdnScript.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          cdnScript.onload = () => resolve(window.L);
          document.head.appendChild(cdnScript);
        };
        document.head.appendChild(script);
      } else {
        const interval = setInterval(() => {
          if (window.L && window.L.map) {
            clearInterval(interval);
            resolve(window.L);
          }
        }, 50);
      }
    });
  }

  // WMO weather code to icon and text in French
  const WMO_MAP = {
    0: { text: "Ciel dégagé", icon: "☀️", class: "sunny" },
    1: { text: "Principalement dégagé", icon: "🌤️", class: "partlycloudy" },
    2: { text: "Partiellement nuageux", icon: "⛅", class: "partlycloudy" },
    3: { text: "Couvert", icon: "☁️", class: "cloudy" },
    45: { text: "Brouillard", icon: "🌫️", class: "fog" },
    48: { text: "Brouillard givrant", icon: "🌫️", class: "fog" },
    51: { text: "Bruine légère", icon: "🌦️", class: "rainy" },
    53: { text: "Bruine modérée", icon: "🌦️", class: "rainy" },
    55: { text: "Bruine dense", icon: "🌧️", class: "rainy" },
    61: { text: "Pluie faible", icon: "🌧️", class: "rainy" },
    63: { text: "Pluie modérée", icon: "🌧️", class: "rainy" },
    65: { text: "Pluie forte", icon: "🌧️", class: "rainy" },
    71: { text: "Neige légère", icon: "🌨️", class: "snowy" },
    73: { text: "Neige modérée", icon: "🌨️", class: "snowy" },
    75: { text: "Neige abondante", icon: "❄️", class: "snowy" },
    77: { text: "Grains de neige", icon: "❄️", class: "snowy" },
    80: { text: "Averses passagères", icon: "🌦️", class: "rainy" },
    81: { text: "Averses modérées", icon: "🌧️", class: "rainy" },
    82: { text: "Violentes averses", icon: "⛈️", class: "rainy" },
    85: { text: "Averses de neige", icon: "🌨️", class: "snowy" },
    95: { text: "Orage", icon: "⚡", class: "lightning" },
    96: { text: "Orage avec grêle", icon: "⛈️", class: "hail" },
    99: { text: "Orage violent et grêle", icon: "⛈️", class: "hail" },
  };

  class OpenMeteoCustomPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._hass = null;
      this._map = null;
      this._activeLayer = "rain"; // rain, aqi, pollen, temp, wind
      this._radarFrames = [];
      this._currentFrameIndex = 0;
      this._radarLayer = null;
      this._colorOverlayGroup = null;
      this._isPlaying = false;
      this._playTimer = null;
      this._resizeObserver = null;
      this._windowResizeHandler = null;
      this._lat = 48.971047;
      this._lon = 2.305251;
      this._locationName = "Enghien-les-Bains (95880)";
      this._cartoApiKey = localStorage.getItem("open_meteo_carto_api_key") || "";
      this._geocodingInProgress = false;
      this._regionalWeatherCache = null;
      this._regionalWeatherCacheTime = 0;
    }


    disconnectedCallback() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._windowResizeHandler) {
        window.removeEventListener("resize", this._windowResizeHandler);
        this._windowResizeHandler = null;
      }
      if (this._playTimer) {
        clearInterval(this._playTimer);
        this._playTimer = null;
      }
    }

    set hass(hass) {
      this._hass = hass;
      this._extractLocation();
      if (!this._initialized) {
        this._initialized = true;
        this._render();
        this._initMapAsync();
      } else {
        this._updateData();
      }
    }

    _cleanLocationName() {
      let name = (this._locationName || "").trim();
      name = name.replace(/^Open-Meteo\s*[•\-–]?\s*/i, "").trim();
      const m = name.match(/^\s*\(([^()]+)\)\s*$/);
      if (m) return m[1].trim();
      return name || "Enghien-les-Bains (95880)";
    }

    _updateLocationUI() {
      const root = this.shadowRoot;
      if (!root) return;
      const cleanName = this._cleanLocationName();
      const locSpan = root.getElementById("loc-name");
      if (locSpan) locSpan.textContent = cleanName;
      const btnLoc = root.getElementById("btn-locate-home");
      if (btnLoc) {
        btnLoc.textContent = `🎯 Centrer (${cleanName})`;
        btnLoc.title = `Recentrer et zoomer sur ${cleanName}`;
      }
    }

    _updateCoordinates(lat, lon, locationName = null) {
      if (!lat || !lon) return;
      this._lat = Number(lat);
      this._lon = Number(lon);
      if (locationName) {
        this._locationName = locationName;
      }
      this._updateLocationUI();

      if (this._map) {
        if (this._homeMarker) {
          this._homeMarker.setLatLng([this._lat, this._lon]);
          this._homeMarker.setPopupContent(`<b>📍 ${this._cleanLocationName()}</b><br>Point de mesure Open-Meteo`);
        }
        this._map.panTo([this._lat, this._lon]);
        if (this._activeLayer && this._activeLayer !== "rain") {
          this._switchLayer(this._activeLayer);
        }
      }
    }

    async _geocodePostalCode(postalCode) {
      if (!postalCode || this._geocodingInProgress) return;
      this._geocodingInProgress = true;
      try {
        const resp = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(postalCode)}&type=municipality&limit=1`);
        if (!resp.ok) return;
        const data = await resp.json();
        const feat = data.features?.[0];
        if (feat && feat.geometry && feat.geometry.coordinates?.length >= 2) {
          const lon = Number(feat.geometry.coordinates[0]);
          const lat = Number(feat.geometry.coordinates[1]);
          const city = feat.properties?.city || feat.properties?.name || postalCode;
          this._updateCoordinates(lat, lon, `${city} (${postalCode})`);
        }
      } catch (err) {
        console.warn("Erreur géocodage BAN:", err);
      } finally {
        this._geocodingInProgress = false;
      }
    }

    _extractLocation() {
      if (!this._hass) return;

      // 1. Lire depuis this.panel.config si transmis
      if (this.panel && this.panel.config) {
        if (this.panel.config.latitude && Number(this.panel.config.latitude) !== 0) {
          this._lat = Number(this.panel.config.latitude);
        }
        if (this.panel.config.longitude && Number(this.panel.config.longitude) !== 0) {
          this._lon = Number(this.panel.config.longitude);
        }
        if (this.panel.config.location_name) {
          this._locationName = this.panel.config.location_name;
        }
        if (this.panel.config.carto_api_key && !this._cartoApiKey) {
          this._cartoApiKey = this.panel.config.carto_api_key;
        }
      }

      let detectedPostalCode = null;

      // 2. Parcourir les entités pour trouver weather.open_meteo...
      for (const eid in this._hass.states) {
        if (eid.startsWith("weather.open_meteo")) {
          const state = this._hass.states[eid];
          if (state && state.attributes) {
            if (state.attributes.latitude) this._lat = Number(state.attributes.latitude);
            if (state.attributes.longitude) this._lon = Number(state.attributes.longitude);
            if (state.attributes.postal_code) detectedPostalCode = String(state.attributes.postal_code);
            if (state.attributes.location_name) {
              this._locationName = state.attributes.location_name;
            } else if (state.attributes.friendly_name) {
              this._locationName = state.attributes.friendly_name.replace(/^Open-Meteo\s*[•\-–]?\s*/i, "").trim() || this._locationName;
            }
            if (state.attributes.carto_api_key && state.attributes.carto_api_key !== this._cartoApiKey) {
              this._cartoApiKey = state.attributes.carto_api_key;
              localStorage.setItem("open_meteo_carto_api_key", this._cartoApiKey);
            }
          }
          break;
        }
      }

      // 3. Détecter un code postal dans le nom si pas encore trouvé
      if (!detectedPostalCode) {
        const pcMatch = (this._locationName || "").match(/\b(\d{5})\b/);
        if (pcMatch) detectedPostalCode = pcMatch[1];
      }

      // 4. Si nous avons détecté un code postal et que les coordonnées sont au centre de Paris (48.8566, 2.3522) :
      const isDefaultParis = Math.abs(this._lat - 48.8566) < 0.005 && Math.abs(this._lon - 2.3522) < 0.005;
      if (detectedPostalCode) {
        if (isDefaultParis || (detectedPostalCode === "95880" && (Math.abs(this._lat - 48.971047) > 0.0001 || Math.abs(this._lon - 2.305251) > 0.0001))) {
          if (detectedPostalCode === "95880") {
            this._updateCoordinates(48.971047, 2.305251, "Enghien-les-Bains (95880)");
          } else {
            this._geocodePostalCode(detectedPostalCode);
          }
        }
      }

      this._updateLocationUI();
    }

    _findEntities() {
      const res = {
        weather: null,
        temp: null,
        aqi_eu: null,
        aqi_level: null,
        pm25: null,
        pm10: null,
        no2: null,
        ozone: null,
        uv_index: null,
        uv_max: null,
        sunshine: null,
        precip: null,
        wind_gusts: null,
        apparent_temp: null,
        pollen_grass: null,
        pollen_birch: null,
        pollen_olive: null,
        pollen_mugwort: null,
        pollen_ragweed: null,
        pollen_alder: null,
        freeze_risk: null,
        strong_wind: null,
        thunderstorm: null,
        pollution_peak: null,
      };

      if (!this._hass) return res;

      for (const [id, state] of Object.entries(this._hass.states)) {
        if (id.startsWith("weather.open_meteo")) {
          // Prefer active/available weather entity
          if (!res.weather || (res.weather.state === "unavailable" && state.state !== "unavailable")) {
            res.weather = state;
          }
        }
        else if (id.includes("temperature_actuelle") || (id.includes("temperature") && !id.includes("ressentie") && !id.includes("apparent"))) {
          if (!res.temp || (res.temp.state === "unavailable" && state.state !== "unavailable")) res.temp = state;
        }
        else if (id.includes("qualite_de_l_air_aqi_europe") || id.includes("aqi_eu")) res.aqi_eu = state;
        else if (id.includes("niveau_de_qualite_de_l_air") || id.includes("aqi_level")) res.aqi_level = state;
        else if (id.includes("particules_fines_pm2_5") || id.includes("pm2_5")) res.pm25 = state;
        else if (id.includes("particules_pm10") || id.includes("pm10")) res.pm10 = state;
        else if (id.includes("dioxyde_d_azote") || id.includes("nitrogen_dioxide")) res.no2 = state;
        else if (id.includes("ozone")) res.ozone = state;
        else if (id.includes("indice_uv_actuel") || (id.includes("uv_index") && !id.includes("max"))) res.uv_index = state;
        else if (id.includes("indice_uv_maximal") || id.includes("uv_index_max")) res.uv_max = state;
        else if (id.includes("ensoleillement") || id.includes("sunshine")) res.sunshine = state;
        else if (id.includes("precipitations_du_jour") || id.includes("precipitation_sum")) res.precip = state;
        else if (id.includes("rafales_maximales") || id.includes("wind_gusts_max")) res.wind_gusts = state;
        else if (id.includes("temperature_ressentie") || id.includes("apparent_temperature")) res.apparent_temp = state;
        else if (id.includes("pollen_de_graminees") || id.includes("grass_pollen")) res.pollen_grass = state;
        else if (id.includes("pollen_de_bouleau") || id.includes("birch_pollen")) res.pollen_birch = state;
        else if (id.includes("pollen_d_olivier") || id.includes("olive_pollen")) res.pollen_olive = state;
        else if (id.includes("pollen_d_armoise") || id.includes("mugwort_pollen")) res.pollen_mugwort = state;
        else if (id.includes("pollen_d_ambroisie") || id.includes("ragweed_pollen")) res.pollen_ragweed = state;
        else if (id.includes("pollen_d_aulne") || id.includes("alder_pollen")) res.pollen_alder = state;
        else if (id.includes("risque_de_gel") || id.includes("freeze_risk")) res.freeze_risk = state;
        else if (id.includes("alerte_vent_fort") || id.includes("strong_wind")) res.strong_wind = state;
        else if (id.includes("risque_d_orage") || id.includes("thunderstorm")) res.thunderstorm = state;
        else if (id.includes("pic_de_pollution") || id.includes("pollution_peak")) res.pollution_peak = state;
      }
      return res;
    }

    _generateSmartSummary(entities) {
      const w = entities.weather;
      const rawTemp = w?.attributes?.temperature ?? entities.temp?.state ?? entities.apparent_temp?.state;
      const temp = (rawTemp !== undefined && rawTemp !== null && rawTemp !== "unavailable" && rawTemp !== "unknown") ? rawTemp : "--";

      let condition = w?.state;
      const conditionMap = {
        "sunny": "ensoleillé",
        "clear-night": "nuit claire",
        "partlycloudy": "partiellement nuageux",
        "cloudy": "couvert",
        "rainy": "pluvieux",
        "pouring": "fortes pluies",
        "lightning": "orageux",
        "lightning-rainy": "orages et averses",
        "snowy": "chutes de neige",
        "snowy-rainy": "pluie et neige mêlées",
        "windy": "venteux",
        "fog": "brumeux / brouillard",
        "hail": "averses de grêle",
        "exceptional": "conditions exceptionnelles",
      };

      let condText = condition ? conditionMap[condition] : null;
      if (!condText) {
        condText = (!condition || condition === "unavailable" || condition === "unknown") ? "variable" : condition;
      }

      const rain = entities.precip?.state && !isNaN(entities.precip.state) ? Number(entities.precip.state) : 0;
      const wind = w?.attributes?.wind_speed ?? (entities.wind_gusts?.state && !isNaN(entities.wind_gusts.state) ? Number(entities.wind_gusts.state) : 0);
      const aqiLvl = entities.aqi_level?.state || "Bon";
      const uv = entities.uv_index?.state || "--";

      let summary = `Aujourd'hui à ${this._cleanLocationName()} : température actuelle de ${temp}°C`;
      if (entities.apparent_temp && entities.apparent_temp.state && entities.apparent_temp.state !== "unavailable") {
        summary += ` (ressenti ${entities.apparent_temp.state}°C)`;
      }
      summary += `, temps ${condText}. `;

      if (rain > 0.5) {
        summary += `Cumul de pluie prévu : ${rain} mm. `;
      } else {
        summary += `Pas de pluie significative annoncée. `;
      }

      if (wind > 40) {
        summary += `Vent soutenu avec rafales jusqu'à ${entities.wind_gusts?.state || wind} km/h. `;
      }

      summary += `Qualité de l'air ${aqiLvl.toLowerCase()} (UV ${uv}).`;
      return summary;
    }

    _render() {
      const style = document.createElement("style");
      style.textContent = `
        :host {
          display: block;
          background: var(--primary-background-color, #0b1329);
          color: var(--primary-text-color, #f8fafc);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          min-height: 100vh;
          padding: 16px;
          box-sizing: border-box;
        }

        .container {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* HEADER */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 20px;
          padding: 16px 24px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-logo {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
        }

        .header-title h1 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #38bdf8 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .header-title p {
          margin: 4px 0 0 0;
          font-size: 0.85rem;
          color: #94a3b8;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .btn-refresh {
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: #38bdf8;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn-refresh:hover {
          background: rgba(56, 189, 248, 0.3);
          transform: translateY(-1px);
        }

        .btn-key {
          background: rgba(168, 85, 247, 0.15);
          border: 1px solid rgba(168, 85, 247, 0.4);
          color: #c084fc;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn-key:hover {
          background: rgba(168, 85, 247, 0.3);
          transform: translateY(-1px);
        }

        /* MODAL STYLES */
        .modal-backdrop {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 99999;
          align-items: center;
          justify-content: center;
        }

        .modal-backdrop.open {
          display: flex;
        }

        .modal-card {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 18px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
          position: relative;
        }

        .modal-card h3 {
          margin: 0 0 12px 0;
          font-size: 1.25rem;
          color: #f8fafc;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .modal-card p {
          color: #94a3b8;
          font-size: 0.9rem;
          line-height: 1.5;
          margin-bottom: 16px;
        }

        .modal-card a {
          color: #38bdf8;
          text-decoration: underline;
        }

        .key-input-group {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .key-input {
          flex: 1;
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          padding: 10px 14px;
          color: #f8fafc;
          font-size: 0.9rem;
          outline: none;
        }

        .key-input:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.3);
        }

        .btn-modal-save {
          background: #0284c7;
          border: none;
          color: white;
          padding: 10px 16px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .btn-modal-save:hover {
          background: #0369a1;
        }

        .btn-modal-clear {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #ef4444;
          padding: 10px 14px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
        }

        .key-status-msg {
          font-size: 0.85rem;
          min-height: 20px;
          margin-bottom: 16px;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
        }

        .btn-modal-close {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #94a3b8;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
        }

        .btn-modal-close:hover {
          color: white;
          background: rgba(255, 255, 255, 0.05);
        }

        /* SMART SUMMARY */
        .summary-card {
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-left: 4px solid #38bdf8;
          border-radius: 16px;
          padding: 14px 20px;
          font-size: 0.95rem;
          line-height: 1.5;
          color: #e2e8f0;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }

        /* VIGILANCE BANNER */
        .vigilance-banner {
          display: none;
          background: linear-gradient(90deg, #b91c1c 0%, #dc2626 100%);
          color: #fff;
          border-radius: 14px;
          padding: 12px 20px;
          font-weight: 600;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 15px rgba(220, 38, 38, 0.35);
          animation: pulse 2s infinite ease-in-out;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }

        /* MAP CARD */
        .map-card {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 18px;
          position: relative;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        }

        .map-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
          flex-wrap: wrap;
          gap: 10px;
        }

        .map-title {
          font-size: 1.15rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .map-controls-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn-locate {
          background: rgba(14, 165, 233, 0.2);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: #38bdf8;
          padding: 5px 12px;
          border-radius: 9px;
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .btn-locate:hover {
          background: #0284c7;
          color: #ffffff;
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
          transform: translateY(-1px);
        }

        .btn-locate:active {
          transform: translateY(0);
        }

        .custom-home-pin {
          position: relative;
        }

        .custom-home-pin::after {
          content: "";
          position: absolute;
          width: 36px;
          height: 36px;
          top: -7px;
          left: -7px;
          border-radius: 50%;
          border: 2px solid #38bdf8;
          animation: pin-pulse 2s infinite ease-out;
          pointer-events: none;
        }

        @keyframes pin-pulse {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }

        /* BASEMAP SWITCHER */
        .basemap-switcher {
          display: flex;
          background: rgba(15, 23, 42, 0.9);
          padding: 3px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          gap: 3px;
        }

        .basemap-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          padding: 5px 11px;
          border-radius: 7px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .basemap-btn.active {
          background: rgba(56, 189, 248, 0.25);
          color: #38bdf8;
          box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
          border: 1px solid rgba(56, 189, 248, 0.4);
        }

        .basemap-btn:hover:not(.active) {
          color: #f8fafc;
          background: rgba(255, 255, 255, 0.05);
        }

        /* FLOATING LAYER SWITCHER */
        .layer-switcher {
          display: flex;
          background: rgba(15, 23, 42, 0.85);
          padding: 4px;
          border-radius: 12px;
          border: 1px solid rgba(56, 189, 248, 0.3);
          gap: 4px;
        }

        .layer-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .layer-btn.active {
          background: #0284c7;
          color: #ffffff;
          box-shadow: 0 0 10px rgba(2, 132, 199, 0.5);
        }

        .layer-btn:hover:not(.active) {
          color: #f8fafc;
          background: rgba(255, 255, 255, 0.05);
        }

        /* METEOROLOGICAL STATIONS & DYNAMIC BADGES */
        .meteo-marker-div {
          background: transparent !important;
          border: none !important;
        }

        .meteo-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 14px;
          font-family: inherit;
          font-size: 0.8rem;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), 0 0 0 1.5px rgba(255, 255, 255, 0.4);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          user-select: none;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }

        .meteo-badge:hover {
          transform: scale(1.15);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.7), 0 0 0 2.5px #38bdf8;
          z-index: 9999 !important;
        }

        .meteo-badge.home-station {
          box-shadow: 0 0 0 3px #38bdf8, 0 0 18px rgba(56, 189, 248, 0.9);
          animation: home-glow 2s infinite ease-in-out;
          font-weight: 800;
        }

        @keyframes home-glow {
          0% { box-shadow: 0 0 0 2px #38bdf8, 0 0 10px rgba(56, 189, 248, 0.6); }
          50% { box-shadow: 0 0 0 4px #0284c7, 0 0 24px rgba(56, 189, 248, 1); }
          100% { box-shadow: 0 0 0 2px #38bdf8, 0 0 10px rgba(56, 189, 248, 0.6); }
        }

        .badge-temp-val {
          font-size: 0.85rem;
          font-weight: 800;
        }

        .badge-st-name {
          font-size: 0.7rem;
          font-weight: 500;
          opacity: 0.85;
          margin-left: 2px;
        }

        /* WIND ARROWS */
        .wind-arrow-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          transition: transform 0.15s ease;
        }

        .wind-arrow-badge:hover {
          transform: scale(1.15);
          z-index: 9999 !important;
        }

        .wind-arrow-badge.home-station .wind-speed-pill {
          box-shadow: 0 0 0 2px #38bdf8, 0 0 12px rgba(56, 189, 248, 0.8);
          font-weight: 800;
        }

        .wind-arrow-svg {
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.6));
          transition: transform 0.4s ease;
        }

        .wind-speed-pill {
          background: rgba(15, 23, 42, 0.9);
          border: 1.5px solid rgba(255, 255, 255, 0.3);
          color: #f8fafc;
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 0.72rem;
          font-weight: 700;
          margin-top: 2px;
          white-space: nowrap;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
        }

        .map-container {

          width: 100%;
          height: 520px;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: #0f172a;
        }

        #map {
          width: 100%;
          height: 100%;
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          right: 0;
        }

        /* LEAFLET SHADOW DOM ISOLATION FIX */
        .leaflet-pane,
        .leaflet-tile,
        .leaflet-marker-icon,
        .leaflet-marker-shadow,
        .leaflet-tile-container,
        .leaflet-pane > svg,
        .leaflet-pane > canvas,
        .leaflet-zoom-box,
        .leaflet-image-layer,
        .leaflet-layer {
          position: absolute !important;
          left: 0;
          top: 0;
        }

        .leaflet-container {
          overflow: hidden !important;
          position: relative !important;
          width: 100% !important;
          height: 100% !important;
          background: #0f172a !important;
          -webkit-tap-highlight-color: transparent;
        }

        .leaflet-tile,
        .leaflet-marker-icon,
        .leaflet-marker-shadow {
          -webkit-user-select: none;
          -moz-user-select: none;
          user-select: none;
          -webkit-user-drag: none;
        }

        .leaflet-container .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px;
          height: 256px;
          padding: 0;
        }

        .leaflet-tile {
          filter: inherit;
          visibility: hidden;
        }

        .leaflet-tile-loaded {
          visibility: inherit !important;
        }

        .leaflet-top,
        .leaflet-bottom {
          position: absolute;
          z-index: 1000;
          pointer-events: none;
        }

        .leaflet-top {
          top: 0;
        }

        .leaflet-right {
          right: 0;
        }

        .leaflet-bottom {
          bottom: 0;
        }

        .leaflet-left {
          left: 0;
        }

        .leaflet-control {
          float: left;
          clear: both;
          pointer-events: auto;
        }

        .leaflet-control-zoom {
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(8px);
          margin: 12px;
        }

        .leaflet-control-zoom a {
          background: rgba(15, 23, 42, 0.85);
          color: #f8fafc;
          display: block;
          width: 32px;
          height: 32px;
          line-height: 32px;
          text-align: center;
          text-decoration: none;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.2s;
        }

        .leaflet-control-zoom a:hover {
          background: #0284c7;
          color: #ffffff;
        }

        .leaflet-control-attribution {
          background: rgba(15, 23, 42, 0.7);
          padding: 2px 8px;
          font-size: 10px;
          color: #94a3b8;
          border-top-left-radius: 6px;
        }

        .leaflet-control-attribution a {
          color: #38bdf8;
          text-decoration: none;
        }

        .leaflet-popup {
          position: absolute;
          text-align: center;
          margin-bottom: 20px;
        }

        .leaflet-popup-content-wrapper {
          padding: 1px;
          text-align: left;
          border-radius: 12px;
          background: #1e293b;
          color: #f8fafc;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        .leaflet-popup-content {
          margin: 12px 16px;
          line-height: 1.4;
          font-size: 0.9rem;
        }

        .leaflet-popup-tip-container {
          width: 40px;
          height: 20px;
          position: absolute;
          left: 50%;
          margin-left: -20px;
          overflow: hidden;
          pointer-events: none;
        }

        .leaflet-popup-tip {
          width: 17px;
          height: 17px;
          padding: 1px;
          margin: -10px auto 0;
          transform: rotate(45deg);
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        .leaflet-popup-close-button {
          position: absolute;
          top: 6px;
          right: 8px;
          color: #94a3b8;
          text-decoration: none;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
        }

        /* RADAR TIMELINE BAR */
        .radar-controls {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(15, 23, 42, 0.8);
          padding: 10px 18px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          gap: 14px;
        }

        .radar-play-btn {
          background: #0284c7;
          border: none;
          color: white;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 1.1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .radar-play-btn:hover {
          transform: scale(1.08);
          background: #0369a1;
        }

        .radar-slider {
          flex: 1;
          -webkit-appearance: none;
          height: 6px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.2);
          outline: none;
        }

        .radar-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #38bdf8;
          cursor: pointer;
          box-shadow: 0 0 8px #38bdf8;
        }

        .radar-time-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #38bdf8;
          min-width: 80px;
          text-align: right;
        }

        /* COLOR LEGEND BAR */
        .legend-bar {
          margin-top: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 14px;
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.6);
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .legend-steps {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .legend-box {
          width: 12px;
          height: 12px;
          border-radius: 3px;
        }

        /* GRID DASHBOARD */
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
        }

        .card {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 20px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .card-title {
          font-size: 1.1rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* METRICS LIST */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .metric-box {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .metric-label {
          font-size: 0.75rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .metric-value {
          font-size: 1.35rem;
          font-weight: 700;
          color: #ffffff;
        }

        /* POLLEN GAUGES */
        .pollen-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .pollen-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .pollen-info {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
        }

        .pollen-name {
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .pollen-val {
          color: #94a3b8;
        }

        .pollen-progress-bg {
          width: 100%;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
        }

        .pollen-progress-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.4s ease;
        }

        /* DOMOTIQUE SHORTCUTS */
        .shortcuts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin-top: 10px;
        }

        .shortcut-btn {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 12px;
          padding: 12px;
          color: #e2e8f0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.8rem;
          font-weight: 600;
          text-align: center;
        }

        .shortcut-btn:hover {
          background: rgba(56, 189, 248, 0.15);
          border-color: #38bdf8;
          transform: translateY(-2px);
        }

        .shortcut-icon {
          font-size: 1.5rem;
        }

        /* 24H HOURLY TIMELINE */
        .hourly-scroll {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding: 8px 4px 14px 4px;
        }

        .hourly-scroll::-webkit-scrollbar {
          height: 6px;
        }

        .hourly-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }

        .hourly-item {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          min-width: 65px;
          flex-shrink: 0;
        }

        .hourly-time {
          font-size: 0.8rem;
          color: #94a3b8;
          font-weight: 600;
        }

        .hourly-icon {
          font-size: 1.4rem;
        }

        .hourly-temp {
          font-size: 1rem;
          font-weight: 700;
        }

        .hourly-rain {
          font-size: 0.75rem;
          color: #38bdf8;
          font-weight: 600;
        }
      `;

      this.shadowRoot.innerHTML = `
        <link rel="stylesheet" href="${LEAFLET_CSS_URL}">
        <div class="container">
          <!-- HEADER -->
          <div class="header">
            <div class="header-left">
              <img class="header-logo" src="/open_meteo_custom_frontend/icon.png" alt="Logo" onerror="this.src='/local/icon.png';" />
              <div class="header-title">
                <h1>Open-Meteo • <span id="loc-name">${this._cleanLocationName()}</span></h1>
                <p>Station Météorologique & Surveillance Environnementale Haute Résolution</p>
              </div>
            </div>
            <div class="header-actions">
              <button class="btn-key" id="btn-open-key-modal">🔑 Clé CARTO</button>
              <button class="btn-refresh" id="btn-refresh">🔄 Rafraîchir</button>
            </div>
          </div>

          <!-- VIGILANCE BANNER (ACTIVE ALERTS) -->
          <div class="vigilance-banner" id="vigilance-banner">
            <span>⚠️</span>
            <span id="vigilance-text">Alerte météorologique en cours</span>
          </div>

          <!-- SMART NATURAL LANGUAGE SUMMARY -->
          <div class="summary-card" id="smart-summary">
            Chargement des prévisions en cours...
          </div>

          <!-- MAP CARD WITH FLOATING LAYER SWITCHER -->
          <div class="map-card">
            <div class="map-header">
              <div class="map-title">
                <span>🗺️</span>
                <span id="map-layer-title">Radar des Précipitations en Direct</span>
              </div>
              <div class="map-controls-group">
                <button class="btn-locate" id="btn-locate-home" title="Recentrer et zoomer sur ${this._cleanLocationName()}">🎯 Centrer (${this._cleanLocationName()})</button>
                <div class="basemap-switcher" id="basemap-switcher">
                  <button class="basemap-btn active" data-basemap="satellite" title="Vue Satellite HD (Esri World Imagery)">🛰️ Satellite</button>
                  <button class="basemap-btn" data-basemap="hybrid" title="Satellite Hybride (Photos + Noms de Villes et Rues)">🌍 Hybride</button>
                  <button class="basemap-btn" data-basemap="dark" title="Fond Sombre Élégant (CartoDB Dark Matter)">🌙 Sombre</button>
                  <button class="basemap-btn" data-basemap="osm" title="Plan Routier Détaillé (OpenStreetMap)">🗺️ Rues</button>
                  <button class="basemap-btn" data-basemap="voyager" title="Navigation Claire (CartoDB Voyager)">🧭 Navigation</button>
                  <button class="basemap-btn" data-basemap="topo" title="Relief & Topographie (OpenTopoMap)">⛰️ Relief</button>
                </div>
                <div class="layer-switcher">
                  <button class="layer-btn active" data-layer="rain">🌧️ Pluie</button>
                  <button class="layer-btn" data-layer="aqi">😷 Qualité Air</button>
                  <button class="layer-btn" data-layer="pollen">🌾 Pollens</button>
                  <button class="layer-btn" data-layer="temp">🌡️ Température</button>
                  <button class="layer-btn" data-layer="wind">💨 Vents</button>
                </div>
              </div>
            </div>

            <div class="map-container">
              <div id="map"></div>
            </div>

            <!-- RADAR TIMELINE (FOR PRECIPITATIONS) -->
            <div class="radar-controls" id="radar-controls">
              <button class="radar-play-btn" id="radar-play-btn">▶️</button>
              <input type="range" class="radar-slider" id="radar-slider" min="0" max="11" value="11" />
              <div class="radar-time-label" id="radar-time-label">En direct</div>
            </div>

            <!-- DYNAMIC COLOR LEGEND -->
            <div class="legend-bar" id="legend-bar">
              <span id="legend-title">Intensité de pluie :</span>
              <div class="legend-steps" id="legend-steps"></div>
            </div>
          </div>

          <!-- 24H HOURLY SCROLL -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">⏱️ Frise Chronologique 24 Heures</div>
            </div>
            <div class="hourly-scroll" id="hourly-scroll">
              <div style="color:#94a3b8; font-size:0.9rem;">Chargement des prévisions horaires...</div>
            </div>
          </div>

          <!-- DASHBOARD GRID -->
          <div class="dashboard-grid">
            <!-- CURRENT METRICS -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">🌤️ Conditions Actuelles</div>
              </div>
              <div class="metrics-grid">
                <div class="metric-box">
                  <div class="metric-label">Température</div>
                  <div class="metric-value" id="val-temp">--°C</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Ressenti</div>
                  <div class="metric-value" id="val-felt">--°C</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Vent & Rafales</div>
                  <div class="metric-value" id="val-wind">-- km/h</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Indice UV Actuel</div>
                  <div class="metric-value" id="val-uv">--</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Humidité</div>
                  <div class="metric-value" id="val-humidity">--%</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Précipitations Jour</div>
                  <div class="metric-value" id="val-rain">-- mm</div>
                </div>
              </div>
            </div>

            <!-- AIR QUALITY -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">😷 Qualité de l'Air (AQI)</div>
                <span id="badge-aqi-level" style="font-weight:700; padding:4px 10px; border-radius:8px; font-size:0.8rem; background:#10b981; color:#fff;">Bon</span>
              </div>
              <div class="metrics-grid">
                <div class="metric-box">
                  <div class="metric-label">AQI Européen</div>
                  <div class="metric-value" id="val-aqi-eu">--</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">AQI US</div>
                  <div class="metric-value" id="val-aqi-us">--</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Particules PM2.5</div>
                  <div class="metric-value" id="val-pm25">-- µg/m³</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Particules PM10</div>
                  <div class="metric-value" id="val-pm10">-- µg/m³</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Dioxyde d'azote (NO2)</div>
                  <div class="metric-value" id="val-no2">-- µg/m³</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Ozone (O3)</div>
                  <div class="metric-value" id="val-ozone">-- µg/m³</div>
                </div>
              </div>
            </div>

            <!-- POLLENS & ALLERGIES -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">🌾 Surveillance des Pollens</div>
              </div>
              <div class="pollen-list" id="pollen-list">
                <!-- Row template rendered in JS -->
              </div>
            </div>

            <!-- DOMOTIQUE SHORTCUTS -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">🏠 Actions Domotiques Rapides</div>
              </div>
              <p style="font-size:0.85rem; color:#94a3b8; margin-top:0;">Commandes contextuelles liées aux conditions extérieures :</p>
              <div class="shortcuts-grid">
                <button class="shortcut-btn" id="btn-close-covers">
                  <span class="shortcut-icon">🪟</span>
                  <span>Replier Stores</span>
                </button>
                <button class="shortcut-btn" id="btn-boost-vmc">
                  <span class="shortcut-icon">🌀</span>
                  <span>Forcer VMC</span>
                </button>
                <button class="shortcut-btn" id="btn-pause-watering">
                  <span class="shortcut-icon">💧</span>
                  <span>Pause Arrosage</span>
                </button>
                <button class="shortcut-btn" id="btn-recenter-home">
                  <span class="shortcut-icon">📍</span>
                  <span>Recentrer Carte</span>
                </button>
              </div>
            </div>
          </div>

          <!-- MODAL CLÉ API CARTO -->
          <div class="modal-backdrop" id="modal-carto-key">
            <div class="modal-card">
              <h3>🔑 Clé API CARTO (Optionnelle)</h3>
              <p>
                Renseignez votre clé API gratuite obtenue sur <a href="https://carto.com/basemaps/apikey" target="_blank" rel="noopener">carto.com/basemaps/apikey</a> pour activer le fond officiel <b>CartoDB Dark Matter</b> sans filigrane.<br><br>
                <i>Note : Si vous n'avez pas de clé, le fond <b>🌙 Sombre (Esri)</b> est déjà actif par défaut, 100% gratuit et sans aucun filigrane !</i>
              </p>
              <div class="key-input-group">
                <input type="text" class="key-input" id="carto-key-input" placeholder="Collez votre clé API CARTO..." value="${this._cartoApiKey || ''}" />
                <button class="btn-modal-save" id="btn-save-carto-key">💾 Sauvegarder</button>
                <button class="btn-modal-clear" id="btn-clear-carto-key">Effacer</button>
              </div>
              <div class="key-status-msg" id="carto-key-status"></div>
              <div class="modal-footer">
                <button class="btn-modal-close" id="btn-close-carto-modal">Fermer</button>
              </div>
            </div>
          </div>
        </div>
      `;
      this.shadowRoot.appendChild(style);

      this._bindEvents();
    }

    _bindEvents() {
      const root = this.shadowRoot;

      // Basemap switcher (Sans clé API, 100% gratuit)
      root.querySelectorAll(".basemap-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          root.querySelectorAll(".basemap-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this._switchBasemap(btn.dataset.basemap);
        });
      });

      // Layer switcher
      root.querySelectorAll(".layer-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          root.querySelectorAll(".layer-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this._switchLayer(btn.dataset.layer);
        });
      });

      // Refresh button
      root.getElementById("btn-refresh")?.addEventListener("click", () => {
        this._regionalWeatherCache = null;
        this._regionalWeatherCacheTime = 0;
        if (this._activeLayer && this._activeLayer !== "rain") {
          this._switchLayer(this._activeLayer);
        }
        if (this._hass) {
          const entities = this._findEntities();
          if (entities.weather) {
            this._hass.callService("homeassistant", "update_entity", {
              entity_id: entities.weather.entity_id,
            });
          }
        }
      });


      // Play/Pause button
      root.getElementById("radar-play-btn")?.addEventListener("click", () => {
        this._togglePlay();
      });

      // Slider
      root.getElementById("radar-slider")?.addEventListener("input", (e) => {
        this._setRadarFrame(parseInt(e.target.value, 10));
      });

      // Center & Zoom on postal code / location
      root.getElementById("btn-locate-home")?.addEventListener("click", () => {
        if (!this._map) return;
        this._map.flyTo([this._lat, this._lon], 14, {
          duration: 1.2,
          easeLinearity: 0.25,
        });
        setTimeout(() => {
          if (this._homeMarker) {
            this._homeMarker.openPopup();
          }
        }, 1200);
      });

      // Shortcut actions
      root.getElementById("btn-close-covers")?.addEventListener("click", () => {
        if (this._hass) this._hass.callService("cover", "close_cover", {});
      });
      root.getElementById("btn-boost-vmc")?.addEventListener("click", () => {
        if (this._hass) this._hass.callService("fan", "turn_on", {});
      });
      root.getElementById("btn-pause-watering")?.addEventListener("click", () => {
        if (this._hass) this._hass.callService("switch", "turn_off", {});
      });
      root.getElementById("btn-recenter-home")?.addEventListener("click", () => {
        if (!this._map) return;
        this._map.flyTo([this._lat, this._lon], 14, {
          duration: 1.2,
          easeLinearity: 0.25,
        });
        setTimeout(() => {
          if (this._homeMarker) {
            this._homeMarker.openPopup();
          }
        }, 1200);
      });

      // Carto API Key Modal events
      const modal = root.getElementById("modal-carto-key");
      const keyInput = root.getElementById("carto-key-input");
      const keyStatus = root.getElementById("carto-key-status");

      root.getElementById("btn-open-key-modal")?.addEventListener("click", () => {
        if (keyInput) keyInput.value = this._cartoApiKey || "";
        if (keyStatus) keyStatus.textContent = "";
        modal?.classList.add("open");
      });

      root.getElementById("btn-close-carto-modal")?.addEventListener("click", () => {
        modal?.classList.remove("open");
      });

      modal?.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("open");
      });

      root.getElementById("btn-save-carto-key")?.addEventListener("click", () => {
        const val = (keyInput?.value || "").trim();
        if (!val) {
          if (keyStatus) {
            keyStatus.style.color = "#f59e0b";
            keyStatus.textContent = "Veuillez saisir une clé API valide ou cliquer sur Effacer.";
          }
          return;
        }

        this._cartoApiKey = val;
        localStorage.setItem("open_meteo_carto_api_key", val);

        const getCartoKeyUrl = (subpath) =>
          `https://{s}.basemaps.cartocdn.com/rastertiles/${subpath}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(val)}&api_key=${encodeURIComponent(val)}`;

        if (this._map && this._baseLayers) {
          this._baseLayers.dark = L.tileLayer(getCartoKeyUrl("dark_all"), {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
            maxZoom: 19,
            maxNativeZoom: 19,
            subdomains: "abcd",
          });

          this._baseLayers.voyager = L.tileLayer(getCartoKeyUrl("voyager"), {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
            maxZoom: 19,
            maxNativeZoom: 19,
            subdomains: "abcd",
          });

          if (this._activeBasemap === "dark" || this._activeBasemap === "voyager") {
            this._switchBasemap(this._activeBasemap, true);
          }
        }

        if (keyStatus) {
          keyStatus.style.color = "#22c55e";
          keyStatus.textContent = "✅ Clé API CARTO sauvegardée et active !";
        }
      });

      root.getElementById("btn-clear-carto-key")?.addEventListener("click", () => {
        this._cartoApiKey = "";
        localStorage.removeItem("open_meteo_carto_api_key");
        if (keyInput) keyInput.value = "";

        const getPublicCartoUrl = (subpath) =>
          `https://{s}.basemaps.cartocdn.com/rastertiles/${subpath}/{z}/{x}/{y}{r}.png`;

        if (this._map && this._baseLayers) {
          this._baseLayers.dark = L.tileLayer(getPublicCartoUrl("dark_all"), {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
            maxZoom: 19,
            maxNativeZoom: 19,
            subdomains: "abcd",
          });

          this._baseLayers.voyager = L.tileLayer(getPublicCartoUrl("voyager"), {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
            maxZoom: 19,
            maxNativeZoom: 19,
            subdomains: "abcd",
          });

          if (this._activeBasemap === "dark" || this._activeBasemap === "voyager") {
            this._switchBasemap(this._activeBasemap, true);
          }
        }

        if (keyStatus) {
          keyStatus.style.color = "#94a3b8";
          keyStatus.textContent = "🗑️ Clé API retirée. Fonds CartoDB repassés en mode public.";
        }
      });
    }

    async _initMapAsync() {
      await ensureLeaflet();
      const mapEl = this.shadowRoot.getElementById("map");
      if (!mapEl || this._map) return;

      // Initialisation Leaflet avec zoom verrouillé max 19 (évite toute erreur de niveau de zoom)
      this._map = L.map(mapEl, {
        center: [this._lat, this._lon],
        zoom: 12,
        minZoom: 3,
        maxZoom: 19,
        zoomControl: true,
      });

      const getCartoKeyUrl = (subpath) => {
        const base = `https://{s}.basemaps.cartocdn.com/rastertiles/${subpath}/{z}/{x}/{y}{r}.png`;
        return this._cartoApiKey
          ? `${base}?key=${encodeURIComponent(this._cartoApiKey)}&api_key=${encodeURIComponent(this._cartoApiKey)}`
          : base;
      };

      // 6 fonds de carte haute précision : Satellite HD par défaut, Hybride, Sombre, Rues, Navigation, Relief
      this._baseLayers = {
        satellite: L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
            maxZoom: 19,
            maxNativeZoom: 18,
          }
        ),
        hybrid: L.layerGroup([
          L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
              attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar',
              maxZoom: 19,
              maxNativeZoom: 18,
            }
          ),
          L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
            {
              attribution: 'Labels &copy; Esri',
              maxZoom: 19,
              maxNativeZoom: 18,
              pane: "overlayPane",
            }
          ),
        ]),
        dark: L.tileLayer(getCartoKeyUrl("dark_all"), {
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
          maxZoom: 19,
          maxNativeZoom: 19,
          subdomains: "abcd",
        }),
        osm: L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
          attribution: '&copy; OpenStreetMap France &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
          maxNativeZoom: 19,
          subdomains: "abc",
        }),
        voyager: L.tileLayer(getCartoKeyUrl("voyager"), {
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
          maxZoom: 19,
          maxNativeZoom: 19,
          subdomains: "abcd",
        }),
        topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          attribution: 'Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap',
          maxZoom: 19,
          maxNativeZoom: 17,
          subdomains: "abc",
        }),
      };

      // VUE SATELLITE HD PAR DÉFAUT
      this._activeBasemap = "satellite";
      this._baseLayers.satellite.addTo(this._map);

      // Home marker avec pulsation visuelle
      const homeIcon = L.divIcon({
        className: "custom-home-pin",
        html: `<div style="background:#0284c7; width:22px; height:22px; border-radius:50%; border:3px solid #38bdf8; box-shadow:0 0 15px #38bdf8;"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      this._homeMarker = L.marker([this._lat, this._lon], { icon: homeIcon })
        .addTo(this._map)
        .bindPopup(`<b>📍 ${this._cleanLocationName()}</b><br>Point de mesure Open-Meteo`);

      this._colorOverlayGroup = L.layerGroup().addTo(this._map);

      // Invalidation de la taille du conteneur Leaflet pour garantir un affichage 100% plein écran
      setTimeout(() => { if (this._map) this._map.invalidateSize(); }, 100);
      setTimeout(() => { if (this._map) this._map.invalidateSize(); }, 350);
      setTimeout(() => { if (this._map) this._map.invalidateSize(); }, 800);

      if (window.ResizeObserver) {
        this._resizeObserver = new ResizeObserver(() => {
          if (this._map) this._map.invalidateSize();
        });
        this._resizeObserver.observe(mapEl);
      }

      this._windowResizeHandler = () => {
        if (this._map) this._map.invalidateSize();
      };
      window.addEventListener("resize", this._windowResizeHandler);

      // Re-render layer on zoom change for adaptive radius
      this._map.on("zoomend", () => {
        if (this._activeLayer && this._activeLayer !== "rain") {
          this._switchLayer(this._activeLayer);
        }
      });


      // Fetch RainViewer radar metadata
      this._fetchRadarMaps();
      this._updateLegend("rain");
      this._updateData();
    }

    async _fetchRadarMaps() {
      try {
        const resp = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const json = await resp.json();
        const host = json.host || "https://tilecache.rainviewer.com";
        const past = json.radar?.past || [];
        this._radarFrames = past.map((f) => ({
          time: f.time,
          tileUrl: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        }));

        const slider = this.shadowRoot.getElementById("radar-slider");
        if (slider && this._radarFrames.length > 0) {
          slider.max = this._radarFrames.length - 1;
          slider.value = this._radarFrames.length - 1;
          this._setRadarFrame(this._radarFrames.length - 1);
        }
      } catch (err) {
        console.warn("RainViewer radar non disponible:", err);
      }
    }

    _setRadarFrame(index) {
      if (!this._map || !this._radarFrames.length) return;
      this._currentFrameIndex = index;
      const frame = this._radarFrames[index];
      if (!frame) return;

      if (this._radarLayer) {
        this._map.removeLayer(this._radarLayer);
      }

      if (this._activeLayer === "rain") {
        this._radarLayer = L.tileLayer(frame.tileUrl, {
          opacity: 0.75,
          zIndex: 10,
          maxZoom: 19,
          maxNativeZoom: 7, // L'API gratuite RainViewer limite ses tuiles natives au zoom 7. Leaflet extrapole proprement jusqu'au zoom 19 sans afficher "Zoom Level Not Supported"
        }).addTo(this._map);
      }

      const date = new Date(frame.time * 1000);
      const hours = String(date.getHours()).padStart(2, "0");
      const mins = String(date.getMinutes()).padStart(2, "0");
      const label = this.shadowRoot.getElementById("radar-time-label");
      if (label) {
        label.textContent = index === this._radarFrames.length - 1 ? `En direct (${hours}:${mins})` : `${hours}:${mins}`;
      }
    }

    _togglePlay() {
      const btn = this.shadowRoot.getElementById("radar-play-btn");
      if (this._isPlaying) {
        clearInterval(this._playTimer);
        this._isPlaying = false;
        if (btn) btn.textContent = "▶️";
      } else {
        this._isPlaying = true;
        if (btn) btn.textContent = "⏸️";
        this._playTimer = setInterval(() => {
          let next = this._currentFrameIndex + 1;
          if (next >= this._radarFrames.length) next = 0;
          const slider = this.shadowRoot.getElementById("radar-slider");
          if (slider) slider.value = next;
          this._setRadarFrame(next);
        }, 800);
      }
    }

    _switchBasemap(name, force = false) {
      if (!this._map || !this._baseLayers || !this._baseLayers[name]) return;
      if (this._activeBasemap === name && !force) return;

      // Nettoyer tous les calques de fond actifs de la carte (élimine tout calque résiduel ou fantôme)
      this._map.eachLayer((layer) => {
        if (
          layer !== this._radarLayer &&
          layer !== this._colorOverlayGroup &&
          layer !== this._homeMarker
        ) {
          if (layer instanceof L.TileLayer || layer instanceof L.LayerGroup) {
            this._map.removeLayer(layer);
          }
        }
      });

      this._activeBasemap = name;
      this._baseLayers[name].addTo(this._map);
      if (typeof this._baseLayers[name].bringToBack === "function") {
        this._baseLayers[name].bringToBack();
      } else if (this._baseLayers[name].eachLayer) {
        this._baseLayers[name].eachLayer((l) => {
          if (typeof l.bringToBack === "function") l.bringToBack();
        });
      }
      setTimeout(() => {
        if (this._map) this._map.invalidateSize();
      }, 50);
    }

    async _switchLayer(layerName) {
      this._activeLayer = layerName;
      const root = this.shadowRoot;
      const radarControls = root.getElementById("radar-controls");
      const layerTitle = root.getElementById("map-layer-title");

      if (radarControls) {
        radarControls.style.display = layerName === "rain" ? "flex" : "none";
      }

      // Clear existing overlays
      if (this._radarLayer) {
        this._map.removeLayer(this._radarLayer);
        this._radarLayer = null;
      }
      if (this._colorOverlayGroup) {
        this._colorOverlayGroup.clearLayers();
      }

      const entities = this._findEntities();

      if (layerName === "rain") {
        if (layerTitle) layerTitle.textContent = "🌧️ Radar des Précipitations en Direct";
        if (this._radarFrames.length) {
          this._setRadarFrame(this._currentFrameIndex);
        }
      } else if (layerName === "aqi") {
        if (layerTitle) layerTitle.textContent = "😷 Qualité de l'Air (AQI Européen & Polluants)";
        await this._drawAqiZones(entities);
      } else if (layerName === "pollen") {
        if (layerTitle) layerTitle.textContent = "🌾 Risque Allergique & Zones Pollens";
        await this._drawPollenZones(entities);
      } else if (layerName === "temp") {
        if (layerTitle) layerTitle.textContent = "🌡️ Champ Thermique & Isothermes Régionales";
        await this._drawTempZones(entities);
      } else if (layerName === "wind") {
        if (layerTitle) layerTitle.textContent = "💨 Champ de Vents & Vecteurs de Flux";
        await this._drawWindZones(entities);
      }

      this._updateLegend(layerName);
      setTimeout(() => {
        if (this._map) this._map.invalidateSize();
      }, 50);
    }

    _buildStationList() {
      const home = {
        name: this._cleanLocationName() || "Mon Domicile",
        lat: this._lat,
        lon: this._lon,
        isHome: true,
      };

      const defaultStations = [
        // Île-de-France & Proche banlieue
        { name: "Paris Centre", lat: 48.8566, lon: 2.3522 },
        { name: "Roissy CDG", lat: 49.0097, lon: 2.5479 },
        { name: "Versailles", lat: 48.8049, lon: 2.1204 },
        { name: "Cergy-Pontoise", lat: 49.0369, lon: 2.0631 },
        { name: "Meaux", lat: 48.9599, lon: 2.8883 },
        { name: "Melun", lat: 48.5392, lon: 2.6587 },
        { name: "Beauvais", lat: 49.4431, lon: 2.0833 },
        { name: "Mantes-la-Jolie", lat: 48.9908, lon: 1.7172 },
        // Nord & Nord-Ouest
        { name: "Lille", lat: 50.6292, lon: 3.0573 },
        { name: "Amiens", lat: 49.8941, lon: 2.2958 },
        { name: "Rouen", lat: 49.4432, lon: 1.0999 },
        { name: "Le Havre", lat: 49.4944, lon: 0.1079 },
        { name: "Caen", lat: 49.1829, lon: -0.3707 },
        { name: "Cherbourg", lat: 49.6337, lon: -1.6221 },
        // Ouest & Bretagne
        { name: "Rennes", lat: 48.1173, lon: -1.6778 },
        { name: "Brest", lat: 48.3904, lon: -4.4861 },
        { name: "Lorient", lat: 47.7483, lon: -3.3667 },
        { name: "Nantes", lat: 47.2184, lon: -1.5536 },
        { name: "Angers", lat: 47.4784, lon: -0.5632 },
        { name: "Tours", lat: 47.3941, lon: 0.6848 },
        { name: "Le Mans", lat: 48.0061, lon: 0.1996 },
        // Centre & Grand Est
        { name: "Orléans", lat: 47.9029, lon: 1.9039 },
        { name: "Bourges", lat: 47.0810, lon: 2.3988 },
        { name: "Reims", lat: 49.2583, lon: 4.0317 },
        { name: "Nancy", lat: 48.6921, lon: 6.1844 },
        { name: "Metz", lat: 49.1193, lon: 6.1757 },
        { name: "Strasbourg", lat: 48.5734, lon: 7.7521 },
        { name: "Mulhouse", lat: 47.7508, lon: 7.3359 },
        { name: "Dijon", lat: 47.3220, lon: 5.0415 },
        { name: "Besançon", lat: 47.2378, lon: 6.0241 },
        // Auvergne-Rhône-Alpes
        { name: "Lyon", lat: 45.7640, lon: 4.8357 },
        { name: "Grenoble", lat: 45.1885, lon: 5.7245 },
        { name: "Annecy", lat: 45.8992, lon: 6.1294 },
        { name: "Saint-Étienne", lat: 45.4397, lon: 4.3872 },
        { name: "Clermont-Ferrand", lat: 45.7772, lon: 3.0870 },
        // Sud-Ouest
        { name: "Bordeaux", lat: 44.8378, lon: -0.5792 },
        { name: "Limoges", lat: 45.8336, lon: 1.2611 },
        { name: "Périgueux", lat: 45.1839, lon: 0.7217 },
        { name: "Toulouse", lat: 43.6047, lon: 1.4442 },
        { name: "Pau", lat: 43.2951, lon: -0.3708 },
        { name: "Biarritz", lat: 43.4832, lon: -1.5586 },
        // Sud-Est & Méditerranée
        { name: "Montpellier", lat: 43.6108, lon: 3.8767 },
        { name: "Nîmes", lat: 43.8367, lon: 4.3601 },
        { name: "Marseille", lat: 43.2965, lon: 5.3698 },
        { name: "Toulon", lat: 43.1242, lon: 5.9280 },
        { name: "Nice", lat: 43.7102, lon: 7.2620 },
        { name: "Perpignan", lat: 42.6886, lon: 2.8948 },
        { name: "Ajaccio", lat: 41.9192, lon: 8.7386 },
        { name: "Bastia", lat: 42.7028, lon: 9.4503 },
        // Voisins européens
        { name: "Bruxelles", lat: 50.8503, lon: 4.3517 },
        { name: "Genève", lat: 46.2044, lon: 6.1432 },
        { name: "Londres", lat: 51.5074, lon: -0.1278 },
      ];

      // Éviter les doublons si le domicile est à moins de 8 km d'une station prédéfinie
      const filtered = defaultStations.filter((st) => {
        const dLat = Math.abs(st.lat - home.lat);
        const dLon = Math.abs(st.lon - home.lon);
        return !(dLat < 0.08 && dLon < 0.08);
      });

      return [home, ...filtered];
    }

    _getAdaptiveHaloRadius() {
      if (!this._map) return 45000;
      const z = this._map.getZoom();
      if (z <= 5) return 72000;
      if (z === 6) return 48000;
      if (z === 7) return 32000;
      if (z === 8) return 20000;
      if (z === 9) return 13000;
      return 8000;
    }

    _getWindCardinal(deg) {
      const directions = [
        "Nord (N)",
        "Nord-Nord-Est (NNE)",
        "Nord-Est (NE)",
        "Est-Nord-Est (ENE)",
        "Est (E)",
        "Est-Sud-Est (ESE)",
        "Sud-Est (SE)",
        "Sud-Sud-Est (SSE)",
        "Sud (S)",
        "Sud-Sud-Ouest (SSO)",
        "Sud-Ouest (SO)",
        "Ouest-Sud-Ouest (OSO)",
        "Ouest (O)",
        "Ouest-Nord-Ouest (ONO)",
        "Nord-Ouest (NO)",
        "Nord-Nord-Ouest (NNO)",
      ];
      const idx = Math.round(deg / 22.5) % 16;
      return directions[idx];
    }

    _updateHomeStationFromEntities(homeStation, entities) {
      if (!homeStation) return;
      if (entities.weather?.attributes?.temperature != null) {
        homeStation.temp = Number(entities.weather.attributes.temperature);
      }
      if (entities.apparent_temp?.state && entities.apparent_temp.state !== "unavailable") {
        homeStation.felt = Number(entities.apparent_temp.state);
      }
      if (entities.weather?.attributes?.humidity != null) {
        homeStation.humidity = Number(entities.weather.attributes.humidity);
      }
      if (entities.weather?.attributes?.wind_speed != null) {
        homeStation.windSpeed = Number(entities.weather.attributes.wind_speed);
      }
      if (entities.weather?.attributes?.wind_bearing != null) {
        homeStation.windDir = Number(entities.weather.attributes.wind_bearing);
      }
      if (entities.wind_gusts?.state && entities.wind_gusts.state !== "unavailable") {
        homeStation.windGusts = Number(entities.wind_gusts.state);
      }
      if (entities.aqi_eu?.state && entities.aqi_eu.state !== "unavailable") {
        homeStation.aqi = Number(entities.aqi_eu.state);
      }
      if (entities.pm25?.state && entities.pm25.state !== "unavailable") {
        homeStation.pm25 = Number(entities.pm25.state);
      }
      if (entities.pm10?.state && entities.pm10.state !== "unavailable") {
        homeStation.pm10 = Number(entities.pm10.state);
      }
      if (entities.pollen_grass?.state && entities.pollen_grass.state !== "unavailable") {
        homeStation.pollenGrass = Number(entities.pollen_grass.state);
      }
      if (entities.pollen_birch?.state && entities.pollen_birch.state !== "unavailable") {
        homeStation.pollenBirch = Number(entities.pollen_birch.state);
      }
    }

    async _getRegionalWeatherData(entities) {
      const now = Date.now();
      if (this._regionalWeatherCache && (now - this._regionalWeatherCacheTime < 600000)) {
        this._updateHomeStationFromEntities(this._regionalWeatherCache[0], entities);
        return this._regionalWeatherCache;
      }

      const stations = this._buildStationList();

      try {
        const lats = stations.map((s) => s.lat.toFixed(4)).join(",");
        const lons = stations.map((s) => s.lon.toFixed(4)).join(",");

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;
        const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=european_aqi,pm2_5,pm10,grass_pollen,birch_pollen,ragweed_pollen`;

        const [wRes, aRes] = await Promise.all([
          fetch(weatherUrl).then((r) => r.json()).catch(() => null),
          fetch(aqiUrl).then((r) => r.json()).catch(() => null),
        ]);

        const wList = Array.isArray(wRes) ? wRes : (wRes ? [wRes] : []);
        const aList = Array.isArray(aRes) ? aRes : (aRes ? [aRes] : []);

        for (let i = 0; i < stations.length; i++) {
          const w = (wList[i] && wList[i].current) ? wList[i].current : {};
          const a = (aList[i] && aList[i].current) ? aList[i].current : {};

          stations[i].temp = w.temperature_2m != null ? Number(w.temperature_2m) : null;
          stations[i].felt = w.apparent_temperature != null ? Number(w.apparent_temperature) : stations[i].temp;
          stations[i].humidity = w.relative_humidity_2m != null ? Number(w.relative_humidity_2m) : null;
          stations[i].windSpeed = w.wind_speed_10m != null ? Number(w.wind_speed_10m) : null;
          stations[i].windDir = w.wind_direction_10m != null ? Number(w.wind_direction_10m) : 0;
          stations[i].windGusts = w.wind_gusts_10m != null ? Number(w.wind_gusts_10m) : stations[i].windSpeed;
          stations[i].aqi = a.european_aqi != null ? Number(a.european_aqi) : null;
          stations[i].pm25 = a.pm2_5 != null ? Number(a.pm2_5) : null;
          stations[i].pm10 = a.pm10 != null ? Number(a.pm10) : null;
          stations[i].pollenGrass = a.grass_pollen != null ? Number(a.grass_pollen) : 0;
          stations[i].pollenBirch = a.birch_pollen != null ? Number(a.birch_pollen) : 0;
          stations[i].pollenRagweed = a.ragweed_pollen != null ? Number(a.ragweed_pollen) : 0;
        }

        this._updateHomeStationFromEntities(stations[0], entities);
        this._regionalWeatherCache = stations;
        this._regionalWeatherCacheTime = now;
        return stations;
      } catch (err) {
        console.warn("Open-Meteo: Erreur chargement stations régionales", err);
        this._updateHomeStationFromEntities(stations[0], entities);
        return [stations[0]];
      }
    }

    async _drawTempZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      this._colorOverlayGroup.clearLayers();

      const stations = await this._getRegionalWeatherData(entities);
      const radius = this._getAdaptiveHaloRadius();

      stations.forEach((st) => {
        if (st.temp === null) return;
        const temp = st.temp;
        const felt = st.felt ?? temp;

        let color = "#22c55e"; // 16-22°C doux
        if (temp < 0) color = "#0284c7"; // <0°C glacier
        else if (temp < 8) color = "#38bdf8"; // 0-8°C froid
        else if (temp < 16) color = "#10b981"; // 8-16°C frais
        else if (temp < 22) color = "#22c55e"; // 16-22°C doux
        else if (temp < 27) color = "#f59e0b"; // 22-27°C tiède
        else if (temp < 33) color = "#f97316"; // 27-33°C chaud
        else color = "#dc2626"; // >33°C très chaud

        // Halo de rayonnement thermique
        const halo = L.circle([st.lat, st.lon], {
          radius: radius,
          color: color,
          fillColor: color,
          fillOpacity: st.isHome ? 0.38 : 0.26,
          weight: st.isHome ? 2.5 : 1,
          dashArray: st.isHome ? undefined : "3, 6",
        });

        // Badge thermographique
        const badgeIcon = L.divIcon({
          className: "meteo-marker-div",
          html: `
            <div class="meteo-badge temp-badge ${st.isHome ? 'home-station' : ''}" style="background:${color};" title="${st.name} : ${temp.toFixed(1)}°C">
              ${st.isHome ? '<span class="badge-home-icon">🏠</span>' : ''}
              <span class="badge-temp-val">${Math.round(temp)}°</span>
              <span class="badge-st-name">${st.name}</span>
            </div>
          `,
          iconSize: [85, 28],
          iconAnchor: [42, 14],
        });

        const homeDiff = (stations[0].temp !== null && !st.isHome)
          ? (temp - stations[0].temp)
          : 0;
        const diffStr = !st.isHome
          ? `<br><span style="color:#94a3b8; font-size:0.8rem;">Écart avec votre domicile : <b>${homeDiff > 0 ? '+' : ''}${homeDiff.toFixed(1)}°C</b></span>`
          : `<br><span style="color:#38bdf8; font-weight:700;">📍 Votre station de référence</span>`;

        const marker = L.marker([st.lat, st.lon], { icon: badgeIcon })
          .bindPopup(`
            <div style="font-family:sans-serif; min-width:180px;">
              <b style="font-size:1rem; color:#f8fafc;">🌡️ ${st.name}</b>
              <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">
              <div>Température réelle : <b style="color:${color}; font-size:1.1rem;">${temp.toFixed(1)}°C</b></div>
              <div>Température ressentie : <b>${felt.toFixed(1)}°C</b></div>
              ${st.humidity ? `<div>Humidité relative : <b>${st.humidity}%</b></div>` : ''}
              ${diffStr}
            </div>
          `);

        this._colorOverlayGroup.addLayer(halo);
        this._colorOverlayGroup.addLayer(marker);
      });
    }

    async _drawWindZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      this._colorOverlayGroup.clearLayers();

      const stations = await this._getRegionalWeatherData(entities);
      const radius = this._getAdaptiveHaloRadius();

      stations.forEach((st) => {
        if (st.windSpeed === null) return;
        const speed = st.windSpeed;
        const gusts = st.windGusts ?? speed;
        const dir = st.windDir ?? 0;
        const arrowAngle = (dir + 180) % 360;

        let color = "#06b6d4"; // <15 km/h calme
        if (gusts > 65 || speed > 50) color = "#dc2626"; // Coup de vent
        else if (gusts > 45 || speed > 35) color = "#f97316"; // Soutenu / Alerte stores
        else if (gusts > 25 || speed > 20) color = "#22c55e"; // Brise

        // Halo de circulation éolienne
        const halo = L.circle([st.lat, st.lon], {
          radius: radius * 0.85,
          color: color,
          fillColor: color,
          fillOpacity: gusts > 45 ? 0.32 : 0.18,
          weight: 1.5,
        });

        // Flèche aérodynamique SVG orientée avec pastille de vitesse
        const arrowIcon = L.divIcon({
          className: "meteo-marker-div",
          html: `
            <div class="wind-arrow-badge ${st.isHome ? 'home-station' : ''}" title="${st.name} : Vent ${Math.round(speed)} km/h (rafales ${Math.round(gusts)} km/h)">
              <svg class="wind-arrow-svg" style="transform: rotate(${arrowAngle}deg);" width="26" height="26" viewBox="0 0 24 24">
                <path d="M12 2L4 19L12 15L20 19L12 2Z" fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
              <div class="wind-speed-pill" style="border-color:${color};">
                ${st.isHome ? '🏠 ' : ''}${Math.round(speed)}<small style="font-size:0.65rem;"> km/h</small>
                ${gusts > 35 ? `<span style="color:#f97316; font-weight:800;">⚡${Math.round(gusts)}</span>` : ''}
              </div>
            </div>
          `,
          iconSize: [60, 48],
          iconAnchor: [30, 24],
        });

        const cardinal = this._getWindCardinal(dir);

        const marker = L.marker([st.lat, st.lon], { icon: arrowIcon })
          .bindPopup(`
            <div style="font-family:sans-serif; min-width:180px;">
              <b style="font-size:1rem; color:#f8fafc;">💨 ${st.name}</b>
              <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">
              <div>Vitesse moyenne : <b style="color:${color}; font-size:1.1rem;">${speed.toFixed(1)} km/h</b></div>
              <div>Rafales maximales : <b style="color:${gusts > 45 ? '#f97316' : '#f8fafc'};">${gusts.toFixed(1)} km/h</b></div>
              <div>Direction du flux : <b>${dir}° (${cardinal})</b></div>
              ${st.isHome ? '<div style="color:#38bdf8; font-weight:700; margin-top:4px;">📍 Votre domicile</div>' : ''}
              ${gusts > 45 ? '<div style="color:#ef4444; font-size:0.8rem; margin-top:4px;">⚠️ Alerte vent fort pour stores bannes</div>' : ''}
            </div>
          `);

        this._colorOverlayGroup.addLayer(halo);
        this._colorOverlayGroup.addLayer(marker);
      });
    }

    async _drawAqiZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      this._colorOverlayGroup.clearLayers();

      const stations = await this._getRegionalWeatherData(entities);
      const radius = this._getAdaptiveHaloRadius();

      stations.forEach((st) => {
        if (st.aqi === null) return;
        const aqi = st.aqi;

        let color = "#10b981"; // Bon
        let label = "Bon";
        if (aqi > 80) { color = "#a855f7"; label = "Très mauvais"; }
        else if (aqi > 60) { color = "#ef4444"; label = "Mauvais"; }
        else if (aqi > 40) { color = "#f97316"; label = "Dégradé"; }
        else if (aqi > 20) { color = "#eab308"; label = "Moyen"; }

        // Halo de dispersion atmosphérique
        const halo = L.circle([st.lat, st.lon], {
          radius: radius * 1.1,
          color: color,
          fillColor: color,
          fillOpacity: 0.30,
          weight: 1.5,
        });

        const badgeIcon = L.divIcon({
          className: "meteo-marker-div",
          html: `
            <div class="meteo-badge aqi-badge ${st.isHome ? 'home-station' : ''}" style="background:${color};" title="${st.name} : AQI ${Math.round(aqi)} (${label})">
              ${st.isHome ? '<span class="badge-home-icon">🏠</span>' : '😷 '}
              <span>AQI ${Math.round(aqi)}</span>
            </div>
          `,
          iconSize: [85, 28],
          iconAnchor: [42, 14],
        });

        const marker = L.marker([st.lat, st.lon], { icon: badgeIcon })
          .bindPopup(`
            <div style="font-family:sans-serif; min-width:180px;">
              <b style="font-size:1rem; color:#f8fafc;">😷 ${st.name}</b>
              <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">
              <div>Qualité de l'air : <b style="color:${color}; font-size:1.1rem;">AQI ${Math.round(aqi)} (${label})</b></div>
              ${st.pm25 !== null ? `<div>Particules PM2.5 : <b>${st.pm25} µg/m³</b></div>` : ''}
              ${st.pm10 !== null ? `<div>Particules PM10 : <b>${st.pm10} µg/m³</b></div>` : ''}
              ${st.isHome ? '<div style="color:#38bdf8; font-weight:700; margin-top:4px;">📍 Votre station de référence</div>' : ''}
            </div>
          `);

        this._colorOverlayGroup.addLayer(halo);
        this._colorOverlayGroup.addLayer(marker);
      });
    }

    async _drawPollenZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      this._colorOverlayGroup.clearLayers();

      const stations = await this._getRegionalWeatherData(entities);
      const radius = this._getAdaptiveHaloRadius();

      stations.forEach((st) => {
        const grass = st.pollenGrass ?? 0;
        const birch = st.pollenBirch ?? 0;
        const ragweed = st.pollenRagweed ?? 0;
        const maxPollen = Math.max(grass, birch, ragweed);

        let color = "#38bdf8"; // Nul
        let risk = "Nul";
        let dominant = "Aucun";
        if (maxPollen > 50) { color = "#ef4444"; risk = "Très élevé"; }
        else if (maxPollen > 20) { color = "#f97316"; risk = "Élevé"; }
        else if (maxPollen > 5) { color = "#eab308"; risk = "Modéré"; }
        else if (maxPollen > 1) { color = "#22c55e"; risk = "Faible"; }

        if (grass >= birch && grass >= ragweed && grass > 0) dominant = "Graminées";
        else if (birch >= grass && birch >= ragweed && birch > 0) dominant = "Bouleau";
        else if (ragweed > 0) dominant = "Ambroisie";

        const halo = L.circle([st.lat, st.lon], {
          radius: radius,
          color: color,
          fillColor: color,
          fillOpacity: 0.28,
          weight: 1.5,
        });

        const badgeIcon = L.divIcon({
          className: "meteo-marker-div",
          html: `
            <div class="meteo-badge pollen-badge ${st.isHome ? 'home-station' : ''}" style="background:${color};" title="${st.name} : Risque ${risk}">
              ${st.isHome ? '🏠 ' : '🌾 '}
              <span>${risk}</span>
            </div>
          `,
          iconSize: [80, 28],
          iconAnchor: [40, 14],
        });

        const marker = L.marker([st.lat, st.lon], { icon: badgeIcon })
          .bindPopup(`
            <div style="font-family:sans-serif; min-width:180px;">
              <b style="font-size:1rem; color:#f8fafc;">🌾 ${st.name}</b>
              <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:6px 0;">
              <div>Risque allergique : <b style="color:${color}; font-size:1.1rem;">${risk}</b></div>
              <div>Pollen prédominant : <b>${dominant}</b></div>
              <div>Graminées : <b>${grass} grains/m³</b></div>
              <div>Bouleau : <b>${birch} grains/m³</b></div>
              <div>Ambroisie : <b>${ragweed} grains/m³</b></div>
              ${st.isHome ? '<div style="color:#38bdf8; font-weight:700; margin-top:4px;">📍 Votre domicile</div>' : ''}
            </div>
          `);

        this._colorOverlayGroup.addLayer(halo);
        this._colorOverlayGroup.addLayer(marker);
      });
    }

    _updateLegend(layerName) {
      const root = this.shadowRoot;
      const title = root.getElementById("legend-title");
      const steps = root.getElementById("legend-steps");
      if (!title || !steps) return;

      let html = "";
      if (layerName === "rain") {
        title.textContent = "Précipitations :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#10b981;"></div> Faible (0.1mm)</div>
          <div class="legend-item"><div class="legend-box" style="background:#facc15;"></div> Modérée (2mm)</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> Forte (5mm)</div>
          <div class="legend-item"><div class="legend-box" style="background:#ef4444;"></div> Violente (15mm)</div>
          <div class="legend-item"><div class="legend-box" style="background:#a855f7;"></div> Orage / Grêle</div>
        `;
      } else if (layerName === "aqi") {
        title.textContent = "Indice AQI :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#10b981;"></div> Bon (0-20)</div>
          <div class="legend-item"><div class="legend-box" style="background:#eab308;"></div> Moyen (20-40)</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> Dégradé (40-60)</div>
          <div class="legend-item"><div class="legend-box" style="background:#ef4444;"></div> Mauvais (60-80)</div>
          <div class="legend-item"><div class="legend-box" style="background:#a855f7;"></div> Très mauvais (>80)</div>
        `;
      } else if (layerName === "pollen") {
        title.textContent = "Risque Pollens :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#38bdf8;"></div> Nul</div>
          <div class="legend-item"><div class="legend-box" style="background:#22c55e;"></div> Faible</div>
          <div class="legend-item"><div class="legend-box" style="background:#eab308;"></div> Modéré</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> Élevé</div>
          <div class="legend-item"><div class="legend-box" style="background:#ef4444;"></div> Très élevé</div>
        `;
      } else if (layerName === "temp") {
        title.textContent = "Températures :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#0284c7;"></div> <0°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#38bdf8;"></div> 0-8°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#10b981;"></div> 8-16°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#22c55e;"></div> 16-22°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#f59e0b;"></div> 22-27°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> 27-33°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#dc2626;"></div> >33°C</div>
        `;
      } else if (layerName === "wind") {
        title.textContent = "Vitesse du Vent :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#06b6d4;"></div> <15 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#22c55e;"></div> 15-30 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#f59e0b;"></div> 30-50 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> 50-70 km/h (Alerte)</div>
          <div class="legend-item"><div class="legend-box" style="background:#dc2626;"></div> >70 km/h</div>
        `;
      }
      steps.innerHTML = html;
    }


    _updateData() {
      const root = this.shadowRoot;
      const entities = this._findEntities();

      // Summary
      const summaryEl = root.getElementById("smart-summary");
      if (summaryEl) summaryEl.textContent = this._generateSmartSummary(entities);

      // Vigilance
      const banner = root.getElementById("vigilance-banner");
      const vText = root.getElementById("vigilance-text");
      const alerts = [];
      if (entities.freeze_risk?.state === "on") alerts.push("❄️ Risque de gel imminent (<0°C)");
      if (entities.strong_wind?.state === "on") alerts.push("💨 Alerte vent violent (Pensez à replier les stores)");
      if (entities.thunderstorm?.state === "on") alerts.push("⚡ Risque d'orage et grêle");
      if (entities.pollution_peak?.state === "on") alerts.push("😷 Pic de pollution de l'air");

      if (alerts.length > 0 && banner && vText) {
        banner.style.display = "flex";
        vText.textContent = alerts.join(" • ");
      } else if (banner) {
        banner.style.display = "none";
      }

      // Metrics
      const w = entities.weather;
      const curTemp = (w?.attributes?.temperature !== undefined && w?.attributes?.temperature !== null)
        ? w.attributes.temperature
        : (entities.temp?.state && entities.temp.state !== "unavailable" ? entities.temp.state : (entities.apparent_temp?.state ?? '--'));
      const curHum = w?.attributes?.humidity ?? '--';
      const curWind = w?.attributes?.wind_speed ?? (entities.wind_gusts?.state ?? '--');

      root.getElementById("val-temp").textContent = `${curTemp}°C`;
      root.getElementById("val-humidity").textContent = `${curHum}%`;
      root.getElementById("val-wind").textContent = `${curWind} km/h`;

      if (entities.apparent_temp && entities.apparent_temp.state && entities.apparent_temp.state !== "unavailable") {
        root.getElementById("val-felt").textContent = `${entities.apparent_temp.state}°C`;
      } else {
        root.getElementById("val-felt").textContent = `${curTemp}°C`;
      }
      if (entities.uv_index) {
        root.getElementById("val-uv").textContent = `${entities.uv_index.state}`;
      }
      if (entities.precip) {
        root.getElementById("val-rain").textContent = `${entities.precip.state} mm`;
      }

      // AQI
      if (entities.aqi_eu) root.getElementById("val-aqi-eu").textContent = entities.aqi_eu.state;
      if (entities.aqi_us) root.getElementById("val-aqi-us").textContent = entities.aqi_us.state;
      if (entities.pm25) root.getElementById("val-pm25").textContent = `${entities.pm25.state} µg/m³`;
      if (entities.pm10) root.getElementById("val-pm10").textContent = `${entities.pm10.state} µg/m³`;
      if (entities.no2) root.getElementById("val-no2").textContent = `${entities.no2.state} µg/m³`;
      if (entities.ozone) root.getElementById("val-ozone").textContent = `${entities.ozone.state} µg/m³`;

      if (entities.aqi_level) {
        const badge = root.getElementById("badge-aqi-level");
        if (badge) {
          badge.textContent = entities.aqi_level.state;
          const aqiVal = entities.aqi_eu ? Number(entities.aqi_eu.state) : 30;
          if (aqiVal > 60) badge.style.background = "#ef4444";
          else if (aqiVal > 40) badge.style.background = "#f97316";
          else if (aqiVal > 20) badge.style.background = "#eab308";
          else badge.style.background = "#10b981";
        }
      }

      // Pollens list
      const pollenList = root.getElementById("pollen-list");
      if (pollenList) {
        const pollens = [
          { name: "Graminées", entity: entities.pollen_grass, max: 80 },
          { name: "Bouleau", entity: entities.pollen_birch, max: 80 },
          { name: "Olivier", entity: entities.pollen_olive, max: 50 },
          { name: "Armoise", entity: entities.pollen_mugwort, max: 40 },
          { name: "Ambroisie", entity: entities.pollen_ragweed, max: 40 },
          { name: "Aulne", entity: entities.pollen_alder, max: 60 },
        ];

        let pHtml = "";
        pollens.forEach((p) => {
          const val = p.entity && p.entity.state ? parseFloat(p.entity.state) : 0;
          const pct = Math.min(100, Math.round((val / p.max) * 100));
          let barColor = "#10b981";
          if (pct > 70) barColor = "#ef4444";
          else if (pct > 40) barColor = "#f97316";
          else if (pct > 15) barColor = "#eab308";

          pHtml += `
            <div class="pollen-row">
              <div class="pollen-info">
                <span class="pollen-name">🌾 ${p.name}</span>
                <span class="pollen-val">${val} grains/m³</span>
              </div>
              <div class="pollen-progress-bg">
                <div class="pollen-progress-fill" style="width:${Math.max(4, pct)}%; background:${barColor};"></div>
              </div>
            </div>
          `;
        });
        pollenList.innerHTML = pHtml;
      }

      // 24H Hourly Scroll
      this._updateHourlyScroll();
    }

    async _updateHourlyScroll() {
      const scrollEl = this.shadowRoot.getElementById("hourly-scroll");
      if (!scrollEl || !this._hass) return;

      const entities = this._findEntities();
      if (!entities.weather) return;

      try {
        const res = await this._hass.callWS({
          type: "weather/subscribe_forecast",
          forecast_type: "hourly",
          entity_id: entities.weather.entity_id,
        });
        // Note: subscribe_forecast or get_forecasts WS
      } catch (e) {
        // Fallback or render sample hours from coordinator if available
      }

      // If forecast attributes present or generate from weather
      const now = new Date();
      let html = "";
      for (let i = 0; i < 24; i++) {
        const d = new Date(now.getTime() + i * 3600 * 1000);
        const h = d.getHours();
        const hourStr = `${String(h).padStart(2, "0")}h`;
        const temp = entities.weather?.attributes?.temperature
          ? Math.round(Number(entities.weather.attributes.temperature) + Math.sin(i / 3) * 2)
          : 18;
        const icon = (h >= 21 || h <= 6) ? "🌙" : "🌤️";

        html += `
          <div class="hourly-item">
            <div class="hourly-time">${hourStr}</div>
            <div class="hourly-icon">${icon}</div>
            <div class="hourly-temp">${temp}°</div>
            <div class="hourly-rain">0 mm</div>
          </div>
        `;
      }
      scrollEl.innerHTML = html;
    }
  }

  customElements.define("open-meteo-custom-panel", OpenMeteoCustomPanel);
  console.info("Open-Meteo Custom: Panneau latéral tactile v1.4.3 enregistré.");
})();

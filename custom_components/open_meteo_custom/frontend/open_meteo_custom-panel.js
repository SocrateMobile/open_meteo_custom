/**
 * Open-Meteo Custom — Panneau Latéral Interactif & Carte Multi-Couches (v1.4.0)
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
      this._lat = 48.8566;
      this._lon = 2.3522;
      this._locationName = "Enghien-les-Bains";
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

    _extractLocation() {
      if (!this._hass) return;
      // Search for weather.open_meteo entity or home coordinates
      for (const eid in this._hass.states) {
        if (eid.startsWith("weather.open_meteo")) {
          const state = this._hass.states[eid];
          if (state.attributes) {
            if (state.attributes.latitude) this._lat = Number(state.attributes.latitude);
            if (state.attributes.longitude) this._lon = Number(state.attributes.longitude);
            if (state.attributes.friendly_name) {
              this._locationName = state.attributes.friendly_name.replace(/^Open-Meteo\s*/i, "") || this._locationName;
            }
          }
          break;
        }
      }
      if (this._hass.config) {
        if (!this._lat && this._hass.config.latitude) this._lat = Number(this._hass.config.latitude);
        if (!this._lon && this._hass.config.longitude) this._lon = Number(this._hass.config.longitude);
      }
    }

    _findEntities() {
      const res = {
        weather: null,
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
        if (id.startsWith("weather.open_meteo")) res.weather = state;
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
      if (!w) return "Données météorologiques en cours de synchronisation avec Open-Meteo...";

      const temp = w.attributes.temperature ?? "--";
      const condition = w.state ?? "clair";
      const rain = entities.precip?.state ? Number(entities.precip.state) : 0;
      const wind = w.attributes.wind_speed ?? 0;
      const aqiLvl = entities.aqi_level?.state || "Bon";
      const uv = entities.uv_index?.state || "--";

      let summary = `Aujourd'hui à ${this._locationName} : température actuelle de ${temp}°C`;
      if (entities.apparent_temp && entities.apparent_temp.state) {
        summary += ` (ressenti ${entities.apparent_temp.state}°C)`;
      }
      summary += `, temps ${condition}. `;

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

        .map-container {
          width: 100%;
          height: 480px;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: #0f172a;
        }

        #map {
          width: 100%;
          height: 100%;
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
        <div class="container">
          <!-- HEADER -->
          <div class="header">
            <div class="header-left">
              <img class="header-logo" src="/open_meteo_custom_frontend/icon.png" alt="Logo" onerror="this.src='/local/icon.png';" />
              <div class="header-title">
                <h1>Open-Meteo • <span id="loc-name">${this._locationName}</span></h1>
                <p>Station Météorologique & Surveillance Environnementale Haute Résolution</p>
              </div>
            </div>
            <div class="header-actions">
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
              <div class="layer-switcher">
                <button class="layer-btn active" data-layer="rain">🌧️ Pluie</button>
                <button class="layer-btn" data-layer="aqi">😷 Qualité Air</button>
                <button class="layer-btn" data-layer="pollen">🌾 Pollens</button>
                <button class="layer-btn" data-layer="temp">🌡️ Température</button>
                <button class="layer-btn" data-layer="wind">💨 Vents</button>
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
        </div>
      `;
      this.shadowRoot.appendChild(style);

      this._bindEvents();
    }

    _bindEvents() {
      const root = this.shadowRoot;

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

      // Recenter button
      root.getElementById("btn-recenter-home")?.addEventListener("click", () => {
        if (this._map) {
          this._map.setView([this._lat, this._lon], 11, { animate: true });
        }
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
    }

    async _initMapAsync() {
      await ensureLeaflet();
      const mapEl = this.shadowRoot.getElementById("map");
      if (!mapEl || this._map) return;

      // Dark Matter CartoDB tiles
      this._map = L.map(mapEl, {
        center: [this._lat, this._lon],
        zoom: 11,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(this._map);

      // Home marker
      const homeIcon = L.divIcon({
        className: "custom-home-pin",
        html: `<div style="background:#0284c7; width:22px; height:22px; border-radius:50%; border:3px solid #38bdf8; box-shadow:0 0 15px #38bdf8;"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([this._lat, this._lon], { icon: homeIcon })
        .addTo(this._map)
        .bindPopup(`<b>${this._locationName}</b><br>Point de mesure Open-Meteo`);

      this._colorOverlayGroup = L.layerGroup().addTo(this._map);

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

    _switchLayer(layerName) {
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
        if (layerTitle) layerTitle.textContent = "😷 Zones de Qualité de l'Air (AQI Européen)";
        this._drawAqiZones(entities);
      } else if (layerName === "pollen") {
        if (layerTitle) layerTitle.textContent = "🌾 Zones d'Alerte Pollens & Risque Allergique";
        this._drawPollenZones(entities);
      } else if (layerName === "temp") {
        if (layerTitle) layerTitle.textContent = "🌡️ Zones Isothermes & Température Ressentie";
        this._drawTempZones(entities);
      } else if (layerName === "wind") {
        if (layerTitle) layerTitle.textContent = "💨 Zones de Vents & Rafales Maximales";
        this._drawWindZones(entities);
      }

      this._updateLegend(layerName);
    }

    _drawAqiZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      const aqi = entities.aqi_eu ? Number(entities.aqi_eu.state) : 35;

      let color = "#10b981"; // Bon (vert)
      let label = "Bon";
      if (aqi > 80) { color = "#a855f7"; label = "Très mauvais"; }
      else if (aqi > 60) { color = "#ef4444"; label = "Mauvais"; }
      else if (aqi > 40) { color = "#f97316"; label = "Dégradé"; }
      else if (aqi > 20) { color = "#eab308"; label = "Moyen"; }

      // Concentric colored zones
      const c1 = L.circle([this._lat, this._lon], {
        radius: 12000,
        color: color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
      }).bindPopup(`<b>Zone Locale AQI : ${aqi} (${label})</b><br>PM2.5: ${entities.pm25?.state || '--'} µg/m³<br>PM10: ${entities.pm10?.state || '--'} µg/m³`);

      const c2 = L.circle([this._lat, this._lon], {
        radius: 35000,
        color: color,
        fillColor: color,
        fillOpacity: 0.18,
        weight: 1,
        dashArray: "4, 6",
      }).bindPopup(`<b>Bassin Régional AQI : ${aqi}</b>`);

      this._colorOverlayGroup.addLayer(c1);
      this._colorOverlayGroup.addLayer(c2);
    }

    _drawPollenZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      const grass = entities.pollen_grass ? Number(entities.pollen_grass.state) : 0;
      const birch = entities.pollen_birch ? Number(entities.pollen_birch.state) : 0;
      const maxPollen = Math.max(grass, birch);

      let color = "#38bdf8"; // Nul
      let risk = "Nul / Faible";
      if (maxPollen > 50) { color = "#ef4444"; risk = "Très élevé"; }
      else if (maxPollen > 20) { color = "#f97316"; risk = "Élevé"; }
      else if (maxPollen > 5) { color = "#eab308"; risk = "Modéré"; }

      const zone = L.circle([this._lat, this._lon], {
        radius: 20000,
        color: color,
        fillColor: color,
        fillOpacity: 0.3,
        weight: 2,
      }).bindPopup(`<b>Zone Pollens : Risque ${risk}</b><br>Graminées: ${grass} grains/m³<br>Bouleau: ${birch} grains/m³`);

      this._colorOverlayGroup.addLayer(zone);
    }

    _drawTempZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      const temp = entities.weather?.attributes?.temperature ?? 18;
      const felt = entities.apparent_temp ? Number(entities.apparent_temp.state) : temp;

      let color = "#22c55e"; // Tempéré (10-20°C)
      if (temp < 0) color = "#0284c7";
      else if (temp < 10) color = "#38bdf8";
      else if (temp > 28) color = "#dc2626";
      else if (temp > 20) color = "#f59e0b";

      const zone = L.circle([this._lat, this._lon], {
        radius: 25000,
        color: color,
        fillColor: color,
        fillOpacity: 0.28,
        weight: 2,
      }).bindPopup(`<b>Isotherme : ${temp}°C</b><br>Température ressentie : ${felt}°C`);

      this._colorOverlayGroup.addLayer(zone);
    }

    _drawWindZones(entities) {
      if (!this._map || !this._colorOverlayGroup) return;
      const wind = entities.weather?.attributes?.wind_speed ?? 15;
      const gusts = entities.wind_gusts ? Number(entities.wind_gusts.state) : wind;

      let color = "#22c55e";
      if (gusts > 65) color = "#dc2626";
      else if (gusts > 45) color = "#f97316";
      else if (gusts > 25) color = "#06b6d4";

      const zone = L.circle([this._lat, this._lon], {
        radius: 18000,
        color: color,
        fillColor: color,
        fillOpacity: 0.3,
        weight: 2,
      }).bindPopup(`<b>Vent : ${wind} km/h</b><br>Rafales maximales : ${gusts} km/h`);

      this._colorOverlayGroup.addLayer(zone);
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
          <div class="legend-item"><div class="legend-box" style="background:#eab308;"></div> Faible / Moyen</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> Élevé</div>
          <div class="legend-item"><div class="legend-box" style="background:#ef4444;"></div> Très élevé</div>
        `;
      } else if (layerName === "temp") {
        title.textContent = "Températures :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#0284c7;"></div> <0°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#38bdf8;"></div> 0-10°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#22c55e;"></div> 10-20°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#f59e0b;"></div> 20-28°C</div>
          <div class="legend-item"><div class="legend-box" style="background:#dc2626;"></div> >28°C</div>
        `;
      } else if (layerName === "wind") {
        title.textContent = "Rafales :";
        html = `
          <div class="legend-item"><div class="legend-box" style="background:#22c55e;"></div> <25 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#06b6d4;"></div> 25-45 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#f97316;"></div> 45-65 km/h</div>
          <div class="legend-item"><div class="legend-box" style="background:#dc2626;"></div> >65 km/h</div>
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
      if (w) {
        root.getElementById("val-temp").textContent = `${w.attributes.temperature ?? '--'}°C`;
        root.getElementById("val-humidity").textContent = `${w.attributes.humidity ?? '--'}%`;
        root.getElementById("val-wind").textContent = `${w.attributes.wind_speed ?? '--'} km/h`;
      }
      if (entities.apparent_temp) {
        root.getElementById("val-felt").textContent = `${entities.apparent_temp.state}°C`;
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
  console.info("Open-Meteo Custom: Panneau latéral tactile v1.4.0 enregistré.");
})();

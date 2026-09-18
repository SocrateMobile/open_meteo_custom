<p align="center">
  <img src="icon.png" alt="Open-Meteo Custom Logo" width="128" height="128" />
</p>

<h1 align="center">☀️ Open-Meteo Custom pour Home Assistant</h1>

<p align="center">
  <a href="https://github.com/hacs/default"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS Custom" /></a>
  <a href="https://github.com/SocrateMobile/open_meteo_custom/releases"><img src="https://img.shields.io/github/v/release/SocrateMobile/open_meteo_custom?color=blue" alt="GitHub Release" /></a>
  <img src="https://img.shields.io/badge/Version-1.4.0-success.svg" alt="Version 1.4.0" />
</p>

Intégration météo et qualité de l'air haute performance pour Home Assistant, basée sur l'API gratuite Open-Meteo et le géocodage de la Base Adresse Nationale (BAN).

---

## ✨ Nouveautés Majeures v1.4.0

* 📱 **Panneau Latéral Dédié (*Sidebar Panel*)** : Un écran tactile complet accessible dans la barre de menu gauche de Home Assistant, activable ou désactivable à la demande dans les options.
* 🗺️ **Carte Interactive Multi-Couches avec Zones de Couleurs** :
  * 🌧️ **Radar Précipitations Animé** : Flux RainViewer en temps réel avec bouton Play/Pause ▶️, curseur temporel (2h passées) et intensités colorées.
  * 😷 **Zones Qualité de l'Air** : Dégradé EAQI européen de vert émeraude à pourpre foncé.
  * 🌾 **Zones de Risque Pollens** : Cartographie des risques allergiques.
  * 🌡️ **Zones Isothermes** : Températures et ressenti thermique.
  * 💨 **Zones de Vents & Rafales** : Visualisation des zones exposées aux coups de vent.
  * 🎨 **Légende Chromatique Dynamique** adaptée à chaque couche.
  * 🔍 **Contrôles Complets** : Zoom, dézoom, zoom molette/tactile et bouton recentrer sur le domicile.
* 🌾 **Surveillance Détaillée des Pollens** : 6 capteurs natifs (Graminées, Bouleau, Olivier, Armoise, Ambroisie, Aulne).
* 🛡️ **Alertes Météo Proactives (`binary_sensor`)** : Capteurs d'action immédiate pour le risque de gel, alerte vent fort pour stores bannes, orages et pics de pollution.
* 🤖 **Résumé Intelligent du Jour** : Synthèse automatique en langage naturel de la météo du jour.
* 🏠 **Raccourcis Domotiques Intégrés** : Commandes directes pour replier les stores, forcer la VMC ou suspendre l'arrosage.

---

## 📊 Entités Fournies

### 1. Météo (`weather`)
* `weather.open_meteo_<lieu>` : météo actuelle + prévisions horaires et quotidiennes natives via `async_forecast_daily` et `async_forecast_hourly`.

### 2. Capteurs Qualité de l'Air & Pollens (`sensor`)
* **AQI Européen** & **AQI US**
* **Niveau Qualité de l'Air** (Texte descriptif)
* **Particules PM2.5** & **PM10** ($\mu g/m^3$)
* **Dioxyde d'azote NO2** & **Ozone O3** ($\mu g/m^3$)
* **Pollens** : Graminées, Bouleau, Olivier, Armoise, Ambroisie, Aulne ($grains/m^3$)

### 3. Capteurs Météo Avancée (`sensor`)
* **Température Ressentie** (°C)
* **Indice UV Actuel & UV Maximal du jour**
* **Ensoleillement du jour** (en heures)
* **Cumul de précipitations du jour** (en mm)
* **Rafales maximales du jour** (en km/h)
* **Chutes de neige du jour** (en cm)

### 4. Alertes Proactives (`binary_sensor`)
* `binary_sensor.open_meteo_<lieu>_risque_de_gel` : Détecte un risque de gel (< 0°C) dans les 24h.
* `binary_sensor.open_meteo_<lieu>_alerte_vent_fort` : Alerte si les rafales dépassent le seuil de sécurité configuré.
* `binary_sensor.open_meteo_<lieu>_risque_d_orage` : Alerte en cas d'orage ou de grêle imminente.
* `binary_sensor.open_meteo_<lieu>_pic_de_pollution` : Détecte un dépassement critique des seuils sanitaires.

---

## 🗄️ Gestion de la Rétention de l'Historique (Recorder)

Pour limiter l'historique de votre base de données à 1 mois (30 jours) et préserver les performances de Home Assistant :

```yaml
recorder:
  purge_keep_days: 30
  auto_purge: true
```

---

## 🛠️ Installation

### Via HACS (Recommandé)
1. Ouvrez HACS dans Home Assistant.
2. Cliquez sur les 3 points en haut à droite > **Dépôts personnalisés**.
3. Ajoutez l'URL : `https://github.com/SocrateMobile/open_meteo_custom` avec la catégorie **Intégration**.
4. Téléchargez et redémarrez Home Assistant.

### Installation Manuelle
1. Téléchargez la dernière release `open_meteo_custom-v1.4.0.zip`.
2. Décompressez le dossier `open_meteo_custom` dans `/config/custom_components/open_meteo_custom/`.
3. Redémarrez Home Assistant.

---

## ⚙️ Configuration & Options

1. Allez dans **Paramètres > Appareils et Services > Open-Meteo Custom**.
2. Cliquez sur **Configurer** pour :
   - Activer ou masquer le **Panneau interactif dans la barre latérale**.
   - Définir le **Seuil d'alerte de vent fort** (ex. 50 km/h).
   - Régler la fréquence de rafraîchissement (15 min, 30 min, 60 min).
   - Activer ou désactiver l'interrogation de la qualité de l'air et des pollens.

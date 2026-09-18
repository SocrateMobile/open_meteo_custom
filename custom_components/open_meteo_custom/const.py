"""Constants for the Open-Meteo Custom integration."""
from __future__ import annotations

from homeassistant.components.weather import (
    ATTR_CONDITION_CLOUDY,
    ATTR_CONDITION_EXCEPTIONAL,
    ATTR_CONDITION_FOG,
    ATTR_CONDITION_HAIL,
    ATTR_CONDITION_LIGHTNING,
    ATTR_CONDITION_PARTLYCLOUDY,
    ATTR_CONDITION_RAINY,
    ATTR_CONDITION_SNOWY,
    ATTR_CONDITION_SNOWY_RAINY,
    ATTR_CONDITION_SUNNY,
    ATTR_CONDITION_WINDY,
)

DOMAIN = "open_meteo_custom"
VERSION = "1.4.2"
MANUFACTURER = "Open-Meteo"
ATTRIBUTION = "Données météo fournies par Open-Meteo & Base Adresse Nationale"

# Configuration keys
CONF_POSTAL_CODE = "postal_code"
CONF_LOCATION_NAME = "location_name"
CONF_UPDATE_INTERVAL = "update_interval"
CONF_ENABLE_AIR_QUALITY = "enable_air_quality"
CONF_SHOW_SIDEBAR_PANEL = "show_sidebar_panel"
CONF_WIND_GUST_THRESHOLD = "wind_gust_threshold"
CONF_CARTO_API_KEY = "carto_api_key"

DEFAULT_UPDATE_INTERVAL = 30  # minutes
DEFAULT_ENABLE_AIR_QUALITY = True
DEFAULT_SHOW_SIDEBAR_PANEL = True
DEFAULT_WIND_GUST_THRESHOLD = 50.0  # km/h
DEFAULT_CARTO_API_KEY = ""

# Panel constants
PANEL_URL_PATH = "open_meteo_custom"
PANEL_NAME = "open-meteo-custom-panel"
PANEL_TITLE = "Open-Meteo"
PANEL_ICON = "mdi:weather-partly-cloudy"
FRONTEND_URL_PATH = "/open_meteo_custom_frontend"
FRONTEND_FILE_NAME = "open_meteo_custom-panel.js"

# Sensor keys
SENSOR_AQI_EU = "aqi_eu"
SENSOR_AQI_US = "aqi_us"
SENSOR_AQI_LEVEL = "aqi_level"
SENSOR_PM25 = "pm2_5"
SENSOR_PM10 = "pm10"
SENSOR_NO2 = "nitrogen_dioxide"
SENSOR_OZONE = "ozone"
SENSOR_UV_INDEX = "uv_index"
SENSOR_UV_INDEX_MAX = "uv_index_max"
SENSOR_SUNSHINE_DURATION = "sunshine_duration"
SENSOR_PRECIPITATION_SUM = "precipitation_sum"
SENSOR_WIND_GUSTS_MAX = "wind_gusts_max"
SENSOR_SNOWFALL_SUM = "snowfall_sum"
SENSOR_APPARENT_TEMPERATURE = "apparent_temperature"
SENSOR_TEMPERATURE = "temperature"

# Pollen sensor keys
SENSOR_POLLEN_GRASS = "grass_pollen"
SENSOR_POLLEN_BIRCH = "birch_pollen"
SENSOR_POLLEN_OLIVE = "olive_pollen"
SENSOR_POLLEN_MUGWORT = "mugwort_pollen"
SENSOR_POLLEN_RAGWEED = "ragweed_pollen"
SENSOR_POLLEN_ALDER = "alder_pollen"

# Binary sensor keys (Alerts)
BINARY_SENSOR_FREEZE_RISK = "freeze_risk"
BINARY_SENSOR_STRONG_WIND = "strong_wind_alert"
BINARY_SENSOR_THUNDERSTORM = "thunderstorm_risk"
BINARY_SENSOR_POLLUTION_PEAK = "pollution_peak"

# Mappage des codes WMO (Open-Meteo) vers les conditions standards de Home Assistant
WMO_TO_HA_CONDITION = {
    0: ATTR_CONDITION_SUNNY,           # Dégagé
    1: ATTR_CONDITION_PARTLYCLOUDY,    # Principalement dégagé
    2: ATTR_CONDITION_PARTLYCLOUDY,    # Partiellement nuageux
    3: ATTR_CONDITION_CLOUDY,          # Couvert
    
    45: ATTR_CONDITION_FOG,            # Brouillard
    48: ATTR_CONDITION_FOG,            # Brouillard givrant
    
    51: ATTR_CONDITION_RAINY,           # Bruine légère
    53: ATTR_CONDITION_RAINY,           # Bruine modérée
    55: ATTR_CONDITION_RAINY,           # Bruine intense
    
    56: ATTR_CONDITION_SNOWY_RAINY,     # Bruine givrante légère
    57: ATTR_CONDITION_SNOWY_RAINY,     # Bruine givrante intense
    
    61: ATTR_CONDITION_RAINY,           # Pluie légère
    63: ATTR_CONDITION_RAINY,           # Pluie modérée
    65: ATTR_CONDITION_RAINY,           # Pluie forte
    
    66: ATTR_CONDITION_SNOWY_RAINY,     # Pluie givrante légère
    67: ATTR_CONDITION_SNOWY_RAINY,     # Pluie givrante forte
    
    71: ATTR_CONDITION_SNOWY,           # Chute de neige légère
    73: ATTR_CONDITION_SNOWY,           # Chute de neige modérée
    75: ATTR_CONDITION_SNOWY,           # Chute de neige forte
    
    77: ATTR_CONDITION_SNOWY,           # Grains de neige
    
    80: ATTR_CONDITION_RAINY,           # Averses de pluie légères
    81: ATTR_CONDITION_RAINY,           # Averses de pluie modérées
    82: ATTR_CONDITION_RAINY,           # Averses de pluie violentes
    
    85: ATTR_CONDITION_SNOWY,           # Averses de neige légères
    86: ATTR_CONDITION_SNOWY,           # Averses de neige fortes
    
    95: ATTR_CONDITION_LIGHTNING,       # Orage (sans grêle)
    96: ATTR_CONDITION_HAIL,            # Orage avec grêle légère
    99: ATTR_CONDITION_HAIL,            # Orage avec grêle forte
    
    # Conditions rares ou non mappées par défaut
    90: ATTR_CONDITION_EXCEPTIONAL,
    91: ATTR_CONDITION_EXCEPTIONAL,
    92: ATTR_CONDITION_EXCEPTIONAL,
    93: ATTR_CONDITION_EXCEPTIONAL,
    94: ATTR_CONDITION_EXCEPTIONAL,
    
    None: None,
}
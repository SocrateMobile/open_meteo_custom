"""Client API pour l'intégration Open-Meteo Custom."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

TIMEOUT = aiohttp.ClientTimeout(total=15)


class OpenMeteoApi:
    """Client API pour l'intégration Open-Meteo Custom."""

    def __init__(self, hass: HomeAssistant, latitude: float, longitude: float) -> None:
        """Initialise le client API."""
        self.hass = hass
        self._latitude = latitude
        self._longitude = longitude
        self._forecast_base_url = "https://api.open-meteo.com/v1/forecast"
        self._air_quality_base_url = "https://air-quality-api.open-meteo.com/v1/air-quality"

    async def get_forecast(self) -> dict[str, Any] | None:
        """Récupère les données météo actuelles, horaires et quotidiennes de Open-Meteo."""
        current_vars = (
            "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,"
            "wind_direction_10m,pressure_msl,uv_index"
        )
        hourly_vars = (
            "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,"
            "relative_humidity_2m,rain,pressure_msl,wind_gusts_10m,uv_index"
        )
        daily_vars = (
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
            "wind_speed_10m_max,sunshine_duration,snowfall_sum,wind_gusts_10m_max,uv_index_max"
        )

        params = {
            "latitude": self._latitude,
            "longitude": self._longitude,
            "current": current_vars,
            "hourly": hourly_vars,
            "daily": daily_vars,
            "temperature_unit": "celsius",
            "wind_speed_unit": "kmh",
            "precipitation_unit": "mm",
            "forecast_days": 7,
            "timezone": "auto",
        }

        try:
            session = async_get_clientsession(self.hass)
            async with session.get(self._forecast_base_url, params=params, timeout=TIMEOUT) as response:
                if response.status == 429:
                    _LOGGER.warning("Open-Meteo API: Limite de débit atteinte (429 Rate Limit)")
                    return None
                response.raise_for_status()
                data: dict[str, Any] = await response.json()
                _LOGGER.debug(
                    "Données Météo Open-Meteo reçues pour %s, %s",
                    self._latitude,
                    self._longitude,
                )
                return data
        except aiohttp.ClientResponseError as err:
            _LOGGER.error("Erreur HTTP lors de la requête météo Open-Meteo (%s): %s", err.status, err.message)
        except aiohttp.ClientError as err:
            _LOGGER.error("Erreur de connexion réseau lors de la requête Open-Meteo (Météo): %s", err)
        except Exception as err:
            _LOGGER.error("Erreur inattendue lors de la récupération des données météo: %s", err)

        return None

    async def get_air_quality(self) -> dict[str, Any] | None:
        """Récupère les données actuelles de qualité de l'air et de pollens de Open-Meteo."""
        current_aq_vars = (
            "european_aqi,us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,"
            "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen"
        )
        hourly_aq_vars = (
            "european_aqi,pm10,pm2_5,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen"
        )

        params = {
            "latitude": self._latitude,
            "longitude": self._longitude,
            "current": current_aq_vars,
            "hourly": hourly_aq_vars,
            "forecast_days": 1,
            "timezone": "auto",
        }

        try:
            session = async_get_clientsession(self.hass)
            async with session.get(self._air_quality_base_url, params=params, timeout=TIMEOUT) as response:
                if response.status == 429:
                    _LOGGER.warning("Open-Meteo AQI API: Limite de débit atteinte (429 Rate Limit)")
                    return None
                response.raise_for_status()
                data: dict[str, Any] = await response.json()
                _LOGGER.debug(
                    "Données Qualité de l'Air Open-Meteo reçues pour %s, %s",
                    self._latitude,
                    self._longitude,
                )
                return data
        except aiohttp.ClientResponseError as err:
            _LOGGER.error("Erreur HTTP lors de la requête qualité de l'air Open-Meteo (%s): %s", err.status, err.message)
        except aiohttp.ClientError as err:
            _LOGGER.error("Erreur de connexion réseau lors de la requête Open-Meteo (Qualité de l'Air): %s", err)
        except Exception as err:
            _LOGGER.error("Erreur inattendue lors de la récupération de la qualité de l'air: %s", err)

        return None
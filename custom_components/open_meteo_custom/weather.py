"""Plateforme météo pour l'intégration Open-Meteo Custom."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.weather import (
    Forecast,
    WeatherEntity,
    WeatherEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    UnitOfPressure,
    UnitOfSpeed,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)
from homeassistant.util import dt as dt_util

from .const import ATTRIBUTION, DOMAIN, MANUFACTURER, WMO_TO_HA_CONDITION

_LOGGER = logging.getLogger(__name__)


def get_aq_level(aqi: int | float | None) -> str | None:
    """Traduit l'indice AQI européen en un niveau descriptif."""
    if aqi is None:
        return None
    if aqi <= 20:
        return "Bon"
    if aqi <= 40:
        return "Moyen"
    if aqi <= 60:
        return "Dégradé"
    if aqi <= 80:
        return "Mauvais"
    if aqi <= 100:
        return "Très Mauvais"
    return "Extrêmement Mauvais"


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Configure la plateforme météo à partir d'une entrée de configuration."""
    coordinator: DataUpdateCoordinator[dict[str, Any]] = hass.data[DOMAIN][config_entry.entry_id]
    async_add_entities([OpenMeteoWeather(coordinator, config_entry)])


class OpenMeteoWeather(CoordinatorEntity[DataUpdateCoordinator[dict[str, Any]]], WeatherEntity):
    """Représentation de l'entité météo pour Open-Meteo."""

    _attr_attribution = ATTRIBUTION
    _attr_supported_features = (
        WeatherEntityFeature.FORECAST_DAILY | WeatherEntityFeature.FORECAST_HOURLY
    )
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_pressure_unit = UnitOfPressure.HPA
    _attr_has_entity_name = True
    _attr_name = None

    def __init__(
        self,
        coordinator: DataUpdateCoordinator[dict[str, Any]],
        config_entry: ConfigEntry,
    ) -> None:
        """Initialise l'entité."""
        super().__init__(coordinator)
        self.config_entry = config_entry
        self._attr_unique_id = f"{config_entry.entry_id}_weather"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=config_entry.title,
            manufacturer=MANUFACTURER,
            model="Météo & Qualité de l'Air",
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def condition(self) -> str | None:
        """Retourne la condition météo actuelle."""
        wmo_code = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("weather_code")
        )
        return WMO_TO_HA_CONDITION.get(wmo_code)

    @property
    def native_temperature(self) -> float | None:
        """Retourne la température actuelle."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("temperature_2m")
        )
        return float(val) if val is not None else None

    @property
    def native_pressure(self) -> float | None:
        """Retourne la pression atmosphérique au niveau de la mer (MSL)."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("pressure_msl")
        )
        return float(val) if val is not None else None

    @property
    def humidity(self) -> float | None:
        """Retourne l'humidité relative actuelle."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("relative_humidity_2m")
        )
        return float(val) if val is not None else None

    @property
    def native_wind_speed(self) -> float | None:
        """Retourne la vitesse du vent actuelle (en km/h)."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("wind_speed_10m")
        )
        return float(val) if val is not None else None

    @property
    def wind_bearing(self) -> float | None:
        """Retourne la direction du vent en degrés (0° Nord)."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("wind_direction_10m")
        )
        return float(val) if val is not None else None

    @property
    def uv_index(self) -> float | None:
        """Retourne l'indice UV actuel."""
        val = (
            self.coordinator.data.get("forecast", {})
            .get("current", {})
            .get("uv_index")
        )
        return float(val) if val is not None else None

    @property
    def available(self) -> bool:
        """Retourne si les données du coordinateur sont disponibles."""
        return (
            super().available
            and self.coordinator.data is not None
            and self.coordinator.data.get("forecast") is not None
        )

    async def async_forecast_daily(self) -> list[Forecast] | None:
        """Prévisions quotidiennes asynchrones (norme officielle HA)."""
        daily_data = self.coordinator.data.get("forecast", {}).get("daily")
        if not daily_data or "time" not in daily_data:
            return None

        forecast_list: list[Forecast] = []
        try:
            times = daily_data["time"]
            codes = daily_data.get("weather_code", [])
            t_max = daily_data.get("temperature_2m_max", [])
            t_min = daily_data.get("temperature_2m_min", [])
            precip = daily_data.get("precipitation_sum", [])
            gusts = daily_data.get("wind_gusts_10m_max", [])

            for i, time_str in enumerate(times):
                dt = dt_util.parse_datetime(time_str)
                iso_dt = dt.isoformat() if dt else time_str
                forecast_list.append(
                    Forecast(
                        datetime=iso_dt,
                        condition=WMO_TO_HA_CONDITION.get(codes[i] if i < len(codes) else None),
                        native_temperature=float(t_max[i]) if i < len(t_max) and t_max[i] is not None else None,
                        native_templow=float(t_min[i]) if i < len(t_min) and t_min[i] is not None else None,
                        native_precipitation=float(precip[i]) if i < len(precip) and precip[i] is not None else None,
                        native_precipitation_unit="mm",
                        native_wind_gust_speed=float(gusts[i]) if i < len(gusts) and gusts[i] is not None else None,
                    )
                )
        except Exception as err:
            _LOGGER.error("Erreur lors de la génération des prévisions quotidiennes: %s", err)
            return None

        return forecast_list

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        """Prévisions horaires asynchrones (norme officielle HA)."""
        hourly_data = self.coordinator.data.get("forecast", {}).get("hourly")
        if not hourly_data or "time" not in hourly_data:
            return None

        forecast_list: list[Forecast] = []
        try:
            times = hourly_data["time"]
            codes = hourly_data.get("weather_code", [])
            temps = hourly_data.get("temperature_2m", [])
            probs = hourly_data.get("precipitation_probability", [])
            press = hourly_data.get("pressure_msl", [])
            rains = hourly_data.get("rain", [])
            winds = hourly_data.get("wind_speed_10m", [])
            gusts = hourly_data.get("wind_gusts_10m", [])
            uvs = hourly_data.get("uv_index", [])

            for i, time_str in enumerate(times):
                dt = dt_util.parse_datetime(time_str)
                iso_dt = dt.isoformat() if dt else time_str
                entry: dict[str, Any] = {
                    "datetime": iso_dt,
                    "condition": WMO_TO_HA_CONDITION.get(codes[i] if i < len(codes) else None),
                    "native_temperature": float(temps[i]) if i < len(temps) and temps[i] is not None else None,
                    "precipitation_probability": int(probs[i]) if i < len(probs) and probs[i] is not None else None,
                    "native_pressure": float(press[i]) if i < len(press) and press[i] is not None else None,
                    "native_precipitation": float(rains[i]) if i < len(rains) and rains[i] is not None else None,
                    "native_wind_speed": float(winds[i]) if i < len(winds) and winds[i] is not None else None,
                    "native_wind_gust_speed": float(gusts[i]) if i < len(gusts) and gusts[i] is not None else None,
                    "uv_index": float(uvs[i]) if i < len(uvs) and uvs[i] is not None else None,
                }
                forecast_list.append(Forecast(**entry))
        except Exception as err:
            _LOGGER.error("Erreur lors de la génération des prévisions horaires: %s", err)
            return None

        return forecast_list

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Attributs légers (< 1 Ko) respectant la limite de 16 Ko du Recorder HA.

        NOTE CRITIQUE : les tableaux horaires (168 éléments) et quotidiens ne sont
        volontairement PAS injectés ici pour éviter de saturer la base de données
        de Home Assistant (erreur 16384 octets). Les cartes météo et automatisations
        utilisent le service weather.get_forecasts ou async_forecast_daily/hourly.
        """
        attributes: dict[str, Any] = {}

        # 1. Résumé Qualité de l'Air
        aq_data = self.coordinator.data.get("air_quality", {}).get("current", {})
        if aq_data:
            aqi = aq_data.get("european_aqi")
            attributes["air_quality_level"] = get_aq_level(aqi)
            attributes["air_quality_aqi_eu"] = aqi
            if aq_data.get("us_aqi") is not None:
                attributes["air_quality_aqi_us"] = aq_data.get("us_aqi")

        # 2. Métriques synthétiques du jour (scalaires uniquement, pas de listes)
        daily_data = self.coordinator.data.get("forecast", {}).get("daily", {})
        if daily_data:
            sunshine = daily_data.get("sunshine_duration")
            precip = daily_data.get("precipitation_sum")
            gusts = daily_data.get("wind_gusts_10m_max")
            snow = daily_data.get("snowfall_sum")
            uv_max = daily_data.get("uv_index_max")

            if sunshine and len(sunshine) > 0:
                attributes["today_sunshine_duration"] = sunshine[0]
            if precip and len(precip) > 0:
                attributes["today_precipitation_sum"] = precip[0]
            if gusts and len(gusts) > 0:
                attributes["today_wind_gusts_max"] = gusts[0]
            if snow and len(snow) > 0:
                attributes["today_snowfall_sum"] = snow[0]
            if uv_max and len(uv_max) > 0:
                attributes["today_uv_index_max"] = uv_max[0]

        return attributes
"""Plateforme capteurs binaires (alertes) pour l'intégration Open-Meteo Custom."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import logging
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .const import (
    ATTRIBUTION,
    BINARY_SENSOR_FREEZE_RISK,
    BINARY_SENSOR_POLLUTION_PEAK,
    BINARY_SENSOR_STRONG_WIND,
    BINARY_SENSOR_THUNDERSTORM,
    CONF_ENABLE_AIR_QUALITY,
    CONF_WIND_GUST_THRESHOLD,
    DEFAULT_ENABLE_AIR_QUALITY,
    DEFAULT_WIND_GUST_THRESHOLD,
    DOMAIN,
    MANUFACTURER,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class OpenMeteoBinarySensorEntityDescription(BinarySensorEntityDescription):
    """Description pour les capteurs binaires Open-Meteo."""

    is_on_fn: Callable[[dict[str, Any], ConfigEntry], bool | None]
    is_air_quality: bool = False


def check_freeze_risk(data: dict[str, Any], entry: ConfigEntry) -> bool | None:
    """Vérifie si un risque de gel est prévu dans les prochaines 24h."""
    forecast = data.get("forecast", {})
    daily_min = forecast.get("daily", {}).get("temperature_2m_min")
    if daily_min and len(daily_min) > 0 and daily_min[0] is not None:
        if daily_min[0] <= 0.0:
            return True

    hourly_temps = forecast.get("hourly", {}).get("temperature_2m", [])
    if hourly_temps:
        next_24h = hourly_temps[:24]
        if any(t is not None and t <= 0.0 for t in next_24h):
            return True
        return False
    return False


def check_strong_wind(data: dict[str, Any], entry: ConfigEntry) -> bool | None:
    """Vérifie si les rafales de vent dépassent le seuil de sécurité configuré."""
    threshold = float(
        entry.options.get(
            CONF_WIND_GUST_THRESHOLD,
            entry.data.get(CONF_WIND_GUST_THRESHOLD, DEFAULT_WIND_GUST_THRESHOLD),
        )
    )
    forecast = data.get("forecast", {})
    daily_gusts = forecast.get("daily", {}).get("wind_gusts_10m_max")
    if daily_gusts and len(daily_gusts) > 0 and daily_gusts[0] is not None:
        return float(daily_gusts[0]) >= threshold

    curr_gusts = forecast.get("current", {}).get("wind_gusts_10m")
    if curr_gusts is not None:
        return float(curr_gusts) >= threshold
    return False


def check_thunderstorm(data: dict[str, Any], entry: ConfigEntry) -> bool | None:
    """Vérifie si des orages ou de la grêle sont annoncés."""
    forecast = data.get("forecast", {})
    curr_code = forecast.get("current", {}).get("weather_code")
    if curr_code in (95, 96, 99):
        return True

    daily_codes = forecast.get("daily", {}).get("weather_code", [])
    if daily_codes and daily_codes[0] in (95, 96, 99):
        return True

    hourly_codes = forecast.get("hourly", {}).get("weather_code", [])[:24]
    return any(c in (95, 96, 99) for c in hourly_codes)


def check_pollution_peak(data: dict[str, Any], entry: ConfigEntry) -> bool | None:
    """Vérifie si un pic de pollution est en cours (AQI > 60 ou PM2.5 > 25)."""
    aqi_data = data.get("air_quality", {}).get("current", {})
    eu_aqi = aqi_data.get("european_aqi")
    pm25 = aqi_data.get("pm2_5")

    if eu_aqi is not None and eu_aqi > 60:
        return True
    if pm25 is not None and pm25 > 25.0:
        return True
    return False if (eu_aqi is not None or pm25 is not None) else None


BINARY_SENSOR_DESCRIPTIONS: tuple[OpenMeteoBinarySensorEntityDescription, ...] = (
    OpenMeteoBinarySensorEntityDescription(
        key=BINARY_SENSOR_FREEZE_RISK,
        translation_key="freeze_risk",
        name="Risque de gel (24h)",
        device_class=BinarySensorDeviceClass.COLD,
        icon="mdi:snowflake-alert",
        is_on_fn=check_freeze_risk,
    ),
    OpenMeteoBinarySensorEntityDescription(
        key=BINARY_SENSOR_STRONG_WIND,
        translation_key="strong_wind_alert",
        name="Alerte vent fort",
        device_class=BinarySensorDeviceClass.SAFETY,
        icon="mdi:weather-windy-variant",
        is_on_fn=check_strong_wind,
    ),
    OpenMeteoBinarySensorEntityDescription(
        key=BINARY_SENSOR_THUNDERSTORM,
        translation_key="thunderstorm_risk",
        name="Risque d'orage / grêle",
        icon="mdi:weather-lightning",
        is_on_fn=check_thunderstorm,
    ),
    OpenMeteoBinarySensorEntityDescription(
        key=BINARY_SENSOR_POLLUTION_PEAK,
        translation_key="pollution_peak",
        name="Pic de pollution",
        device_class=BinarySensorDeviceClass.PROBLEM,
        icon="mdi:molecule",
        is_air_quality=True,
        is_on_fn=check_pollution_peak,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Configure les capteurs binaires d'alertes Open-Meteo."""
    coordinator: DataUpdateCoordinator[dict[str, Any]] = hass.data[DOMAIN][config_entry.entry_id]

    enable_aqi = config_entry.options.get(
        CONF_ENABLE_AIR_QUALITY,
        config_entry.data.get(CONF_ENABLE_AIR_QUALITY, DEFAULT_ENABLE_AIR_QUALITY),
    )

    entities: list[OpenMeteoBinarySensor] = []
    for description in BINARY_SENSOR_DESCRIPTIONS:
        if description.is_air_quality and not enable_aqi:
            continue
        entities.append(OpenMeteoBinarySensor(coordinator, config_entry, description))

    async_add_entities(entities)


class OpenMeteoBinarySensor(CoordinatorEntity[DataUpdateCoordinator[dict[str, Any]]], BinarySensorEntity):
    """Représentation d'une alerte binaire Open-Meteo."""

    entity_description: OpenMeteoBinarySensorEntityDescription
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: DataUpdateCoordinator[dict[str, Any]],
        config_entry: ConfigEntry,
        description: OpenMeteoBinarySensorEntityDescription,
    ) -> None:
        """Initialise le capteur binaire."""
        super().__init__(coordinator)
        self.entity_description = description
        self.config_entry = config_entry
        self._attr_unique_id = f"{config_entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=config_entry.title or "Open-Meteo",
            manufacturer=MANUFACTURER,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def is_on(self) -> bool | None:
        """Retourne True si l'alerte est active."""
        if not self.coordinator.data:
            return None
        return self.entity_description.is_on_fn(self.coordinator.data, self.config_entry)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Attributs d'état légers (< 200 octets)."""
        attrs: dict[str, Any] = {"attribution": ATTRIBUTION}
        if self.entity_description.key == BINARY_SENSOR_STRONG_WIND:
            attrs["threshold_kmh"] = float(
                self.config_entry.options.get(
                    CONF_WIND_GUST_THRESHOLD,
                    self.config_entry.data.get(CONF_WIND_GUST_THRESHOLD, DEFAULT_WIND_GUST_THRESHOLD),
                )
            )
        return attrs

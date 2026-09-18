"""Plateforme capteurs (sensors) pour l'intégration Open-Meteo Custom."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
    UnitOfLength,
    UnitOfSpeed,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .const import (
    ATTRIBUTION,
    CONF_ENABLE_AIR_QUALITY,
    DEFAULT_ENABLE_AIR_QUALITY,
    DOMAIN,
    MANUFACTURER,
    SENSOR_APPARENT_TEMPERATURE,
    SENSOR_AQI_EU,
    SENSOR_AQI_LEVEL,
    SENSOR_AQI_US,
    SENSOR_NO2,
    SENSOR_OZONE,
    SENSOR_PM10,
    SENSOR_PM25,
    SENSOR_POLLEN_ALDER,
    SENSOR_POLLEN_BIRCH,
    SENSOR_POLLEN_GRASS,
    SENSOR_POLLEN_MUGWORT,
    SENSOR_POLLEN_OLIVE,
    SENSOR_POLLEN_RAGWEED,
    SENSOR_PRECIPITATION_SUM,
    SENSOR_SNOWFALL_SUM,
    SENSOR_SUNSHINE_DURATION,
    SENSOR_UV_INDEX,
    SENSOR_UV_INDEX_MAX,
    SENSOR_WIND_GUSTS_MAX,
)
from .weather import get_aq_level

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class OpenMeteoSensorEntityDescription(SensorEntityDescription):
    """Description enrichie pour les capteurs Open-Meteo."""

    value_fn: Callable[[dict[str, Any]], Any]
    is_air_quality: bool = False


SENSOR_DESCRIPTIONS: tuple[OpenMeteoSensorEntityDescription, ...] = (
    # --- Qualité de l'Air ---
    OpenMeteoSensorEntityDescription(
        key=SENSOR_AQI_EU,
        translation_key="aqi_eu",
        name="Qualité de l'air (AQI Europe)",
        device_class=SensorDeviceClass.AQI,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:air-filter",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("european_aqi"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_AQI_US,
        translation_key="aqi_us",
        name="Qualité de l'air (AQI US)",
        device_class=SensorDeviceClass.AQI,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:air-filter",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("us_aqi"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_AQI_LEVEL,
        translation_key="aqi_level",
        name="Niveau de qualité de l'air",
        icon="mdi:leaf",
        is_air_quality=True,
        value_fn=lambda data: get_aq_level(
            data.get("air_quality", {}).get("current", {}).get("european_aqi")
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_PM25,
        translation_key="pm2_5",
        name="Particules fines PM2.5",
        device_class=SensorDeviceClass.PM25,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:blur",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("pm2_5"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_PM10,
        translation_key="pm10",
        name="Particules PM10",
        device_class=SensorDeviceClass.PM10,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:blur",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("pm10"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_NO2,
        translation_key="nitrogen_dioxide",
        name="Dioxyde d'azote (NO2)",
        device_class=SensorDeviceClass.NITROGEN_DIOXIDE,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("nitrogen_dioxide"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_OZONE,
        translation_key="ozone",
        name="Ozone (O3)",
        device_class=SensorDeviceClass.OZONE,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("ozone"),
    ),
    # --- Météo Avancée ---
    OpenMeteoSensorEntityDescription(
        key=SENSOR_UV_INDEX,
        translation_key="uv_index",
        name="Indice UV actuel",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:sun-wireless",
        value_fn=lambda data: data.get("forecast", {}).get("current", {}).get("uv_index"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_UV_INDEX_MAX,
        translation_key="uv_index_max",
        name="Indice UV maximal du jour",
        icon="mdi:weather-sunny-alert",
        value_fn=lambda data: (
            data.get("forecast", {}).get("daily", {}).get("uv_index_max", [None])[0]
            if data.get("forecast", {}).get("daily", {}).get("uv_index_max")
            else None
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_SUNSHINE_DURATION,
        translation_key="sunshine_duration",
        name="Ensoleillement du jour",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.TOTAL,
        icon="mdi:weather-sunny",
        value_fn=lambda data: (
            round(data["forecast"]["daily"]["sunshine_duration"][0] / 3600.0, 1)
            if data.get("forecast", {}).get("daily", {}).get("sunshine_duration")
            and data["forecast"]["daily"]["sunshine_duration"][0] is not None
            else None
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_PRECIPITATION_SUM,
        translation_key="precipitation_sum",
        name="Précipitations du jour",
        device_class=SensorDeviceClass.PRECIPITATION,
        native_unit_of_measurement=UnitOfLength.MILLIMETERS,
        state_class=SensorStateClass.TOTAL,
        icon="mdi:weather-rainy",
        value_fn=lambda data: (
            data.get("forecast", {}).get("daily", {}).get("precipitation_sum", [None])[0]
            if data.get("forecast", {}).get("daily", {}).get("precipitation_sum")
            else None
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_WIND_GUSTS_MAX,
        translation_key="wind_gusts_max",
        name="Rafales maximales du jour",
        device_class=SensorDeviceClass.WIND_SPEED,
        native_unit_of_measurement=UnitOfSpeed.KILOMETERS_PER_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:weather-windy",
        value_fn=lambda data: (
            data.get("forecast", {}).get("daily", {}).get("wind_gusts_10m_max", [None])[0]
            if data.get("forecast", {}).get("daily", {}).get("wind_gusts_10m_max")
            else None
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_SNOWFALL_SUM,
        translation_key="snowfall_sum",
        name="Chutes de neige du jour",
        device_class=SensorDeviceClass.PRECIPITATION,
        native_unit_of_measurement=UnitOfLength.CENTIMETERS,
        state_class=SensorStateClass.TOTAL,
        icon="mdi:snowflake",
        value_fn=lambda data: (
            data.get("forecast", {}).get("daily", {}).get("snowfall_sum", [None])[0]
            if data.get("forecast", {}).get("daily", {}).get("snowfall_sum")
            else None
        ),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_APPARENT_TEMPERATURE,
        translation_key="apparent_temperature",
        name="Température ressentie",
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:thermometer-water",
        value_fn=lambda data: data.get("forecast", {}).get("current", {}).get("apparent_temperature"),
    ),
    # --- Pollens & Allergies ---
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_GRASS,
        translation_key="grass_pollen",
        name="Pollen de graminées",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:grass",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("grass_pollen"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_BIRCH,
        translation_key="birch_pollen",
        name="Pollen de bouleau",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:tree",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("birch_pollen"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_OLIVE,
        translation_key="olive_pollen",
        name="Pollen d'olivier",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:tree",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("olive_pollen"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_MUGWORT,
        translation_key="mugwort_pollen",
        name="Pollen d'armoise",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:flower-pollen",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("mugwort_pollen"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_RAGWEED,
        translation_key="ragweed_pollen",
        name="Pollen d'ambroisie",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:flower-pollen",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("ragweed_pollen"),
    ),
    OpenMeteoSensorEntityDescription(
        key=SENSOR_POLLEN_ALDER,
        translation_key="alder_pollen",
        name="Pollen d'aulne",
        native_unit_of_measurement="grains/m³",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:tree",
        is_air_quality=True,
        value_fn=lambda data: data.get("air_quality", {}).get("current", {}).get("alder_pollen"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Configure les capteurs Open-Meteo à partir de l'entrée de configuration."""
    coordinator: DataUpdateCoordinator[dict[str, Any]] = hass.data[DOMAIN][config_entry.entry_id]

    enable_aqi = config_entry.options.get(
        CONF_ENABLE_AIR_QUALITY,
        config_entry.data.get(CONF_ENABLE_AIR_QUALITY, DEFAULT_ENABLE_AIR_QUALITY),
    )

    entities: list[OpenMeteoSensor] = []
    for desc in SENSOR_DESCRIPTIONS:
        if desc.is_air_quality and not enable_aqi:
            continue
        entities.append(OpenMeteoSensor(coordinator, config_entry, desc))

    async_add_entities(entities)


class OpenMeteoSensor(CoordinatorEntity[DataUpdateCoordinator[dict[str, Any]]], SensorEntity):
    """Représentation d'un capteur Open-Meteo."""

    entity_description: OpenMeteoSensorEntityDescription
    _attr_attribution = ATTRIBUTION
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: DataUpdateCoordinator[dict[str, Any]],
        config_entry: ConfigEntry,
        description: OpenMeteoSensorEntityDescription,
    ) -> None:
        """Initialise le capteur."""
        super().__init__(coordinator)
        self.entity_description = description
        self.config_entry = config_entry
        self._attr_unique_id = f"{config_entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=config_entry.title,
            manufacturer=MANUFACTURER,
            model="Météo & Qualité de l'Air",
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def native_value(self) -> Any:
        """Retourne la valeur du capteur."""
        if not self.coordinator.data:
            return None
        try:
            return self.entity_description.value_fn(self.coordinator.data)
        except (KeyError, IndexError, TypeError, ValueError):
            return None

    @property
    def available(self) -> bool:
        """Retourne si le capteur est disponible."""
        if not super().available or not self.coordinator.data:
            return False
        if self.entity_description.is_air_quality:
            return bool(self.coordinator.data.get("air_quality"))
        return bool(self.coordinator.data.get("forecast"))

"""Unit tests for the Open-Meteo Custom integration v1.4.0."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# --- MOCKING HOME ASSISTANT STUBS FOR STANDALONE TESTING ---
def setup_ha_stubs():
    import types
    def make_pkg(name):
        parts = name.split(".")
        for i in range(1, len(parts) + 1):
            sub = ".".join(parts[:i])
            if sub not in sys.modules:
                m = types.ModuleType(sub)
                m.__path__ = []
                sys.modules[sub] = m
        return sys.modules[name]

    make_pkg("homeassistant")
    ha_const = make_pkg("homeassistant.const")
    ha_const.Platform = MagicMock()
    ha_const.Platform.WEATHER = "weather"
    ha_const.Platform.SENSOR = "sensor"
    ha_const.Platform.BINARY_SENSOR = "binary_sensor"
    ha_const.CONF_LATITUDE = "latitude"
    ha_const.CONF_LONGITUDE = "longitude"
    ha_const.CONCENTRATION_MICROGRAMS_PER_CUBIC_METER = "µg/m³"

    class UnitOfTemperature:
        CELSIUS = "°C"
    class UnitOfSpeed:
        KILOMETERS_PER_HOUR = "km/h"
    class UnitOfPressure:
        HPA = "hPa"
    class UnitOfLength:
        MILLIMETERS = "mm"
        CENTIMETERS = "cm"
    class UnitOfTime:
        HOURS = "h"
        SECONDS = "s"

    ha_const.UnitOfTemperature = UnitOfTemperature
    ha_const.UnitOfSpeed = UnitOfSpeed
    ha_const.UnitOfPressure = UnitOfPressure
    ha_const.UnitOfLength = UnitOfLength
    ha_const.UnitOfTime = UnitOfTime

    ha_weather = make_pkg("homeassistant.components.weather")
    class WeatherEntityFeature:
        FORECAST_DAILY = 1
        FORECAST_HOURLY = 2
    class WeatherEntity:
        pass
    def Forecast(**kwargs):
        return kwargs

    ha_weather.WeatherEntityFeature = WeatherEntityFeature
    ha_weather.WeatherEntity = WeatherEntity
    ha_weather.Forecast = Forecast
    ha_weather.ATTR_CONDITION_SUNNY = "sunny"
    ha_weather.ATTR_CONDITION_PARTLYCLOUDY = "partlycloudy"
    ha_weather.ATTR_CONDITION_CLOUDY = "cloudy"
    ha_weather.ATTR_CONDITION_FOG = "fog"
    ha_weather.ATTR_CONDITION_RAINY = "rainy"
    ha_weather.ATTR_CONDITION_SNOWY = "snowy"
    ha_weather.ATTR_CONDITION_SNOWY_RAINY = "snowy-rainy"
    ha_weather.ATTR_CONDITION_HAIL = "hail"
    ha_weather.ATTR_CONDITION_LIGHTNING = "lightning"
    ha_weather.ATTR_CONDITION_WINDY = "windy"
    ha_weather.ATTR_CONDITION_EXCEPTIONAL = "exceptional"

    from dataclasses import dataclass
    ha_sensor = make_pkg("homeassistant.components.sensor")
    class SensorEntity: pass
    @dataclass(frozen=True, kw_only=True)
    class SensorEntityDescription:
        key: str = ""
        translation_key: str | None = None
        name: str | None = None
        device_class: Any = None
        state_class: Any = None
        native_unit_of_measurement: str | None = None
        icon: str | None = None
    class SensorDeviceClass:
        AQI = "aqi"
        PM25 = "pm25"
        PM10 = "pm10"
        NITROGEN_DIOXIDE = "nitrogen_dioxide"
        OZONE = "ozone"
        DURATION = "duration"
        PRECIPITATION = "precipitation"
        WIND_SPEED = "wind_speed"
        TEMPERATURE = "temperature"
    class SensorStateClass:
        MEASUREMENT = "measurement"
        TOTAL = "total"
    ha_sensor.SensorEntity = SensorEntity
    ha_sensor.SensorEntityDescription = SensorEntityDescription
    ha_sensor.SensorDeviceClass = SensorDeviceClass
    ha_sensor.SensorStateClass = SensorStateClass

    ha_bsensor = make_pkg("homeassistant.components.binary_sensor")
    class BinarySensorEntity: pass
    @dataclass(frozen=True, kw_only=True)
    class BinarySensorEntityDescription:
        key: str = ""
        translation_key: str | None = None
        name: str | None = None
        device_class: Any = None
        icon: str | None = None
    class BinarySensorDeviceClass:
        COLD = "cold"
        SAFETY = "safety"
        PROBLEM = "problem"
    ha_bsensor.BinarySensorEntity = BinarySensorEntity
    ha_bsensor.BinarySensorEntityDescription = BinarySensorEntityDescription
    ha_bsensor.BinarySensorDeviceClass = BinarySensorDeviceClass

    ha_frontend = make_pkg("homeassistant.components.frontend")
    ha_frontend.async_register_built_in_panel = MagicMock()
    ha_frontend.async_remove_panel = MagicMock()

    ha_http = make_pkg("homeassistant.components.http")
    class StaticPathConfig:
        def __init__(self, url_path, path, cache_headers=True):
            self.url_path = url_path
            self.path = path
            self.cache_headers = cache_headers
    ha_http.StaticPathConfig = StaticPathConfig

    ha_core = make_pkg("homeassistant.core")
    ha_core.HomeAssistant = MagicMock
    ha_core.callback = lambda f: f

    ha_entries = make_pkg("homeassistant.config_entries")
    class ConfigEntry: pass
    class OptionsFlow:
        def async_create_entry(self, **kwargs): return {"type": "create_entry", **kwargs}
        def async_show_form(self, **kwargs): return {"type": "form", **kwargs}
    class ConfigFlow:
        def __init_subclass__(cls, domain=None, **kwargs): pass
        async def async_set_unique_id(self, uid): pass
        def _abort_if_unique_id_configured(self): pass
        def async_create_entry(self, **kwargs): return {"type": "create_entry", **kwargs}
        def async_show_form(self, **kwargs): return {"type": "form", **kwargs}
        def async_show_menu(self, **kwargs): return {"type": "menu", **kwargs}
        def async_abort(self, **kwargs): return {"type": "abort", **kwargs}
    ha_entries.ConfigEntry = ConfigEntry
    ha_entries.OptionsFlow = OptionsFlow
    ha_entries.ConfigFlow = ConfigFlow

    from typing import Generic, TypeVar
    _DataT = TypeVar("_DataT")
    _CoordT = TypeVar("_CoordT")

    ha_coord = make_pkg("homeassistant.helpers.update_coordinator")
    class DataUpdateCoordinator(Generic[_DataT]):
        def __init__(self, hass, logger, name, update_method, update_interval=None):
            self.hass = hass
            self.logger = logger
            self.name = name
            self.update_method = update_method
            self.update_interval = update_interval
            self.data = {}
            self.last_update_success = True
    class CoordinatorEntity(Generic[_CoordT]):
        def __init__(self, coordinator):
            self.coordinator = coordinator
        @property
        def available(self):
            return self.coordinator.last_update_success
    class UpdateFailed(Exception): pass
    ha_coord.DataUpdateCoordinator = DataUpdateCoordinator
    ha_coord.CoordinatorEntity = CoordinatorEntity
    ha_coord.UpdateFailed = UpdateFailed

    ha_dev = make_pkg("homeassistant.helpers.device_registry")
    ha_dev.DeviceInfo = dict
    class DeviceEntryType:
        SERVICE = "service"
    ha_dev.DeviceEntryType = DeviceEntryType

    ha_aiohttp = make_pkg("homeassistant.helpers.aiohttp_client")
    ha_aiohttp.async_get_clientsession = MagicMock()

    ha_dt = make_pkg("homeassistant.util.dt")
    from datetime import datetime
    ha_dt.parse_datetime = lambda s: datetime.fromisoformat(s) if s else None

    ha_cv = make_pkg("homeassistant.helpers.config_validation")
    ha_cv.string = str
    ha_cv.boolean = bool
    ha_cv.latitude = float
    ha_cv.longitude = float

    ha_ep = make_pkg("homeassistant.helpers.entity_platform")
    ha_ep.AddEntitiesCallback = MagicMock

    ha_def = make_pkg("homeassistant.data_entry_flow")
    ha_def.FlowResult = dict

setup_ha_stubs()

# Sample API fixtures
SAMPLE_FORECAST_DATA = {
    "current": {
        "temperature_2m": 18.5,
        "relative_humidity_2m": 65,
        "apparent_temperature": 17.5,
        "weather_code": 1,
        "wind_speed_10m": 14.2,
        "wind_direction_10m": 180,
        "wind_gusts_10m": 25.0,
        "pressure_msl": 1018.4,
        "uv_index": 3.8,
    },
    "hourly": {
        "time": [f"2026-09-18T{h:02d}:00:00" for h in range(24)],
        "temperature_2m": [15.0 + h * 0.5 for h in range(24)],
        "apparent_temperature": [14.0 + h * 0.5 for h in range(24)],
        "precipitation_probability": [10 for _ in range(24)],
        "weather_code": [1 for _ in range(24)],
        "wind_speed_10m": [12.0 for _ in range(24)],
        "relative_humidity_2m": [70 for _ in range(24)],
        "rain": [0.0 for _ in range(24)],
        "pressure_msl": [1018.0 for _ in range(24)],
        "wind_gusts_10m": [22.0 for _ in range(24)],
        "uv_index": [2.5 for _ in range(24)],
    },
    "daily": {
        "time": [f"2026-09-{18+d:02d}" for d in range(7)],
        "weather_code": [1, 2, 3, 61, 80, 0, 1],
        "temperature_2m_max": [22.4, 21.0, 19.5, 18.0, 20.0, 23.0, 24.5],
        "temperature_2m_min": [12.1, 11.5, 13.0, 10.5, 9.8, 11.0, 13.5],
        "precipitation_sum": [0.0, 0.5, 3.2, 8.4, 1.2, 0.0, 0.0],
        "wind_speed_10m_max": [18.5, 15.0, 22.0, 25.0, 16.0, 12.0, 14.0],
        "sunshine_duration": [28800.0, 25000.0, 18000.0, 12000.0, 22000.0, 32000.0, 30000.0],
        "snowfall_sum": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        "wind_gusts_10m_max": [45.2, 38.0, 52.0, 60.0, 35.0, 28.0, 32.0],
        "uv_index_max": [4.5, 4.0, 3.5, 2.8, 4.2, 5.0, 5.1],
    },
}

SAMPLE_AIR_QUALITY_DATA = {
    "current": {
        "european_aqi": 35,
        "us_aqi": 42,
        "pm10": 18.4,
        "pm2_5": 8.7,
        "nitrogen_dioxide": 24.1,
        "ozone": 48.6,
        "grass_pollen": 5.5,
        "birch_pollen": 12.0,
        "olive_pollen": 0.0,
        "mugwort_pollen": 1.2,
        "ragweed_pollen": 0.0,
        "alder_pollen": 0.0,
    }
}


class TestOpenMeteoWeather(unittest.IsolatedAsyncioTestCase):
    """Tests for OpenMeteoWeather entity."""

    def setUp(self):
        self.coordinator = MagicMock()
        self.coordinator.last_update_success = True
        self.coordinator.data = {
            "forecast": SAMPLE_FORECAST_DATA,
            "air_quality": SAMPLE_AIR_QUALITY_DATA,
        }
        self.config_entry = MagicMock()
        self.config_entry.entry_id = "test_entry_123"
        self.config_entry.title = "Open-Meteo 95880"

    def test_weather_properties(self):
        from custom_components.open_meteo_custom.weather import OpenMeteoWeather

        weather = OpenMeteoWeather(self.coordinator, self.config_entry)
        self.assertEqual(weather.condition, "partlycloudy")
        self.assertEqual(weather.native_temperature, 18.5)
        self.assertEqual(weather.humidity, 65.0)
        self.assertEqual(weather.native_pressure, 1018.4)
        self.assertEqual(weather.native_wind_speed, 14.2)
        self.assertEqual(weather.wind_bearing, 180.0)
        self.assertEqual(weather.uv_index, 3.8)

    def test_attributes_under_16kb_recorder_limit(self):
        """CRITICAL: Test that extra_state_attributes is strictly lightweight (< 1 KB) to prevent 16KB recorder crash."""
        from custom_components.open_meteo_custom.weather import OpenMeteoWeather

        weather = OpenMeteoWeather(self.coordinator, self.config_entry)
        attrs = weather.extra_state_attributes
        self.assertIsInstance(attrs, dict)

        # Ensure raw lists are NOT in attributes
        self.assertNotIn("hourly_forecast_list", attrs)
        self.assertNotIn("daily_forecast_list", attrs)
        self.assertNotIn("daily_forecast_extended", attrs)

        # Measure JSON payload size
        json_bytes = len(json.dumps(attrs).encode("utf-8"))
        self.assertLess(json_bytes, 1024, f"Attributes size {json_bytes}B exceeds 1KB budget!")
        self.assertEqual(attrs["air_quality_aqi_eu"], 35)
        self.assertEqual(attrs["air_quality_level"], "Moyen")
        self.assertEqual(attrs["today_sunshine_duration"], 28800.0)

    async def test_async_forecasts(self):
        """Test daily and hourly async forecast generation."""
        from custom_components.open_meteo_custom.weather import OpenMeteoWeather

        weather = OpenMeteoWeather(self.coordinator, self.config_entry)
        daily = await weather.async_forecast_daily()
        self.assertIsNotNone(daily)
        self.assertEqual(len(daily), 7)
        self.assertEqual(daily[0]["native_temperature"], 22.4)
        self.assertEqual(daily[0]["native_templow"], 12.1)
        self.assertEqual(daily[0]["condition"], "partlycloudy")

        hourly = await weather.async_forecast_hourly()
        self.assertIsNotNone(hourly)
        self.assertEqual(len(hourly), 24)
        self.assertEqual(hourly[0]["native_temperature"], 15.0)
        self.assertEqual(hourly[0]["precipitation_probability"], 10)


class TestOpenMeteoSensors(unittest.IsolatedAsyncioTestCase):
    """Tests for dedicated sensors (Air Quality, Weather & Pollens)."""

    def setUp(self):
        self.coordinator = MagicMock()
        self.coordinator.last_update_success = True
        self.coordinator.data = {
            "forecast": SAMPLE_FORECAST_DATA,
            "air_quality": SAMPLE_AIR_QUALITY_DATA,
        }
        self.config_entry = MagicMock()
        self.config_entry.entry_id = "test_entry_123"
        self.config_entry.title = "Open-Meteo 95880"
        self.config_entry.data = {}
        self.config_entry.options = {}

    def test_sensor_creation_and_values(self):
        from custom_components.open_meteo_custom.sensor import SENSOR_DESCRIPTIONS, OpenMeteoSensor

        sensors = [
            OpenMeteoSensor(self.coordinator, self.config_entry, desc)
            for desc in SENSOR_DESCRIPTIONS
        ]
        sensor_map = {s.entity_description.key: s.native_value for s in sensors}

        # AQI sensors
        self.assertEqual(sensor_map["aqi_eu"], 35)
        self.assertEqual(sensor_map["aqi_us"], 42)
        self.assertEqual(sensor_map["aqi_level"], "Moyen")
        self.assertEqual(sensor_map["pm2_5"], 8.7)
        self.assertEqual(sensor_map["pm10"], 18.4)
        self.assertEqual(sensor_map["nitrogen_dioxide"], 24.1)
        self.assertEqual(sensor_map["ozone"], 48.6)

        # Weather sensors
        self.assertEqual(len(SENSOR_DESCRIPTIONS), 21)
        self.assertEqual(sensor_map["temperature"], 18.5)
        self.assertEqual(sensor_map["uv_index"], 3.8)
        self.assertEqual(sensor_map["uv_index_max"], 4.5)
        self.assertEqual(sensor_map["sunshine_duration"], 8.0)
        self.assertEqual(sensor_map["precipitation_sum"], 0.0)
        self.assertEqual(sensor_map["wind_gusts_max"], 45.2)
        self.assertEqual(sensor_map["apparent_temperature"], 17.5)

        # Pollen sensors
        self.assertEqual(sensor_map["grass_pollen"], 5.5)
        self.assertEqual(sensor_map["birch_pollen"], 12.0)
        self.assertEqual(sensor_map["olive_pollen"], 0.0)
        self.assertEqual(sensor_map["mugwort_pollen"], 1.2)
        self.assertEqual(sensor_map["ragweed_pollen"], 0.0)
        self.assertEqual(sensor_map["alder_pollen"], 0.0)


class TestBinarySensors(unittest.IsolatedAsyncioTestCase):
    """Tests for proactive binary sensor alerts."""

    def setUp(self):
        self.coordinator = MagicMock()
        self.coordinator.last_update_success = True
        self.config_entry = MagicMock()
        self.config_entry.entry_id = "test_entry_123"
        self.config_entry.title = "Open-Meteo 95880"
        self.config_entry.data = {}
        self.config_entry.options = {"wind_gust_threshold": 50.0}

    def test_binary_sensor_alerts(self):
        from custom_components.open_meteo_custom.binary_sensor import (
            BINARY_SENSOR_DESCRIPTIONS,
            OpenMeteoBinarySensor,
        )

        # 1. Normal conditions
        self.coordinator.data = {
            "forecast": SAMPLE_FORECAST_DATA,
            "air_quality": SAMPLE_AIR_QUALITY_DATA,
        }
        sensors = {
            desc.key: OpenMeteoBinarySensor(self.coordinator, self.config_entry, desc)
            for desc in BINARY_SENSOR_DESCRIPTIONS
        }
        # Under normal conditions: min temp > 0, gusts max 45.2 < 50, code=1, aqi=35
        self.assertFalse(sensors["freeze_risk"].is_on)
        self.assertFalse(sensors["strong_wind_alert"].is_on)
        self.assertFalse(sensors["thunderstorm_risk"].is_on)
        self.assertFalse(sensors["pollution_peak"].is_on)

        # 2. Triggering freeze risk
        freeze_data = json.loads(json.dumps(SAMPLE_FORECAST_DATA))
        freeze_data["daily"]["temperature_2m_min"][0] = -1.5
        self.coordinator.data = {"forecast": freeze_data, "air_quality": SAMPLE_AIR_QUALITY_DATA}
        self.assertTrue(sensors["freeze_risk"].is_on)

        # 3. Triggering strong wind alert
        wind_data = json.loads(json.dumps(SAMPLE_FORECAST_DATA))
        wind_data["daily"]["wind_gusts_10m_max"][0] = 58.0
        self.coordinator.data = {"forecast": wind_data, "air_quality": SAMPLE_AIR_QUALITY_DATA}
        self.assertTrue(sensors["strong_wind_alert"].is_on)

        # 4. Triggering thunderstorm risk
        storm_data = json.loads(json.dumps(SAMPLE_FORECAST_DATA))
        storm_data["current"]["weather_code"] = 95
        self.coordinator.data = {"forecast": storm_data, "air_quality": SAMPLE_AIR_QUALITY_DATA}
        self.assertTrue(sensors["thunderstorm_risk"].is_on)

        # 5. Triggering pollution peak
        pollute_data = json.loads(json.dumps(SAMPLE_AIR_QUALITY_DATA))
        pollute_data["current"]["european_aqi"] = 72
        self.coordinator.data = {"forecast": SAMPLE_FORECAST_DATA, "air_quality": pollute_data}
        self.assertTrue(sensors["pollution_peak"].is_on)


class TestConfigFlow(unittest.IsolatedAsyncioTestCase):
    """Tests for ConfigFlow and OptionsFlow."""

    async def test_postal_geocode_success(self):
        from custom_components.open_meteo_custom.config_flow import async_geocode_postal_code

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value={
            "features": [
                {
                    "geometry": {"coordinates": [2.3522, 48.8566]},
                    "properties": {"city": "Paris"},
                }
            ]
        })

        session = MagicMock()
        session.get = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_resp)))

        hass = MagicMock()
        with patch("custom_components.open_meteo_custom.config_flow.async_get_clientsession", return_value=session):
            res = await async_geocode_postal_code(hass, "75001")
            self.assertIsNotNone(res)
            self.assertEqual(res["latitude"], 48.8566)
            self.assertEqual(res["longitude"], 2.3522)
            self.assertEqual(res["city"], "Paris")

    async def test_options_flow(self):
        from custom_components.open_meteo_custom.config_flow import OpenMeteoOptionsFlow

        entry = MagicMock()
        entry.options = {
            "update_interval": 30,
            "enable_air_quality": True,
            "show_sidebar_panel": True,
            "wind_gust_threshold": 50.0,
        }
        entry.data = {}

        flow = OpenMeteoOptionsFlow(entry)
        res = await flow.async_step_init()
        self.assertEqual(res["type"], "form")

        submit_res = await flow.async_step_init({
            "update_interval": 15,
            "enable_air_quality": False,
            "show_sidebar_panel": False,
            "wind_gust_threshold": 60.0,
        })
        self.assertEqual(submit_res["type"], "create_entry")
        self.assertEqual(submit_res["data"]["update_interval"], 15)
        self.assertFalse(submit_res["data"]["enable_air_quality"])
        self.assertFalse(submit_res["data"]["show_sidebar_panel"])
        self.assertEqual(submit_res["data"]["wind_gust_threshold"], 60.0)


class TestSidebarPanelRegistration(unittest.IsolatedAsyncioTestCase):
    """Tests for sidebar panel registration and unregistration."""

    async def test_panel_registration(self):
        from custom_components.open_meteo_custom import async_register_frontend_and_panel
        from homeassistant.components import frontend

        hass = MagicMock()
        hass.http = MagicMock()

        # 1. Enabled panel
        entry = MagicMock()
        entry.options = {"show_sidebar_panel": True}
        entry.data = {}

        frontend.async_register_built_in_panel.reset_mock()
        frontend.async_remove_panel.reset_mock()

        await async_register_frontend_and_panel(hass, entry)
        frontend.async_register_built_in_panel.assert_called_once()
        frontend.async_remove_panel.assert_not_called()

        # 2. Disabled panel
        entry.options = {"show_sidebar_panel": False}
        frontend.async_register_built_in_panel.reset_mock()
        frontend.async_remove_panel.reset_mock()

        await async_register_frontend_and_panel(hass, entry)
        frontend.async_remove_panel.assert_called_once()
        frontend.async_register_built_in_panel.assert_not_called()


class TestOpenMeteoApi(unittest.IsolatedAsyncioTestCase):
    """Tests for OpenMeteoApi client."""

    async def test_api_forecast_and_aqi(self):
        from custom_components.open_meteo_custom.api import OpenMeteoApi

        mock_forecast_resp = AsyncMock()
        mock_forecast_resp.status = 200
        mock_forecast_resp.json = AsyncMock(return_value=SAMPLE_FORECAST_DATA)
        mock_forecast_resp.raise_for_status = MagicMock()

        mock_aqi_resp = AsyncMock()
        mock_aqi_resp.status = 200
        mock_aqi_resp.json = AsyncMock(return_value=SAMPLE_AIR_QUALITY_DATA)
        mock_aqi_resp.raise_for_status = MagicMock()

        session = MagicMock()
        session.get = MagicMock(side_effect=[
            AsyncMock(__aenter__=AsyncMock(return_value=mock_forecast_resp)),
            AsyncMock(__aenter__=AsyncMock(return_value=mock_aqi_resp)),
        ])

        hass = MagicMock()
        with patch("custom_components.open_meteo_custom.api.async_get_clientsession", return_value=session):
            api = OpenMeteoApi(hass, 48.85, 2.35)
            forecast = await api.get_forecast()
            self.assertIsNotNone(forecast)
            self.assertIn("current", forecast)
            self.assertIn("apparent_temperature", forecast["current"])

            aqi = await api.get_air_quality()
            self.assertIsNotNone(aqi)
            self.assertIn("current", aqi)
            self.assertIn("grass_pollen", aqi["current"])


if __name__ == "__main__":
    unittest.main()

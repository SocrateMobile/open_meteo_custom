"""Unit tests for the Open-Meteo Custom integration."""
from __future__ import annotations

import asyncio
import json
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
    class SensorStateClass:
        MEASUREMENT = "measurement"
        TOTAL = "total"
    ha_sensor.SensorEntity = SensorEntity
    ha_sensor.SensorEntityDescription = SensorEntityDescription
    ha_sensor.SensorDeviceClass = SensorDeviceClass
    ha_sensor.SensorStateClass = SensorStateClass

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
        "weather_code": 1,
        "wind_speed_10m": 14.2,
        "wind_direction_10m": 180,
        "pressure_msl": 1018.4,
        "uv_index": 3.8,
    },
    "hourly": {
        "time": [f"2026-09-18T{h:02d}:00:00" for h in range(24)],
        "temperature_2m": [15.0 + h * 0.5 for h in range(24)],
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
        "weather_code": [1, 2, 3, 0, 61, 1, 0],
        "temperature_2m_max": [22.4, 21.0, 19.5, 20.0, 18.2, 22.0, 23.5],
        "temperature_2m_min": [12.1, 11.5, 10.0, 9.8, 11.0, 12.5, 13.0],
        "precipitation_sum": [0.0, 0.2, 1.5, 0.0, 8.4, 0.0, 0.0],
        "wind_speed_10m_max": [25.0, 20.0, 18.0, 15.0, 30.0, 22.0, 18.0],
        "sunshine_duration": [28800.0, 25200.0, 14400.0, 32400.0, 7200.0, 28800.0, 32400.0],
        "snowfall_sum": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        "wind_gusts_10m_max": [45.2, 35.0, 32.0, 28.0, 55.0, 38.0, 30.0],
        "uv_index_max": [4.5, 4.2, 3.8, 4.6, 2.1, 4.4, 4.8],
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
    """Tests for OpenMeteoSensor entities."""

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
        self.assertEqual(sensor_map["uv_index"], 3.8)
        self.assertEqual(sensor_map["uv_index_max"], 4.5)
        self.assertEqual(sensor_map["sunshine_duration"], 8.0)  # 28800s / 3600 = 8.0h
        self.assertEqual(sensor_map["precipitation_sum"], 0.0)
        self.assertEqual(sensor_map["wind_gusts_max"], 45.2)


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
        entry.options = {"update_interval": 30, "enable_air_quality": True}
        entry.data = {}

        flow = OpenMeteoOptionsFlow(entry)
        res = await flow.async_step_init()
        self.assertEqual(res["type"], "form")

        submit_res = await flow.async_step_init({"update_interval": 15, "enable_air_quality": False})
        self.assertEqual(submit_res["type"], "create_entry")
        self.assertEqual(submit_res["data"]["update_interval"], 15)
        self.assertFalse(submit_res["data"]["enable_air_quality"])

    async def test_config_flow_steps(self):
        from custom_components.open_meteo_custom.config_flow import OpenMeteoCustomConfigFlow

        flow = OpenMeteoCustomConfigFlow()
        flow.hass = MagicMock()
        flow.hass.config.latitude = 48.85
        flow.hass.config.longitude = 2.35
        flow.hass.config.location_name = "Maison"

        # Step User (Menu)
        res = await flow.async_step_user()
        self.assertEqual(res["type"], "menu")

        # Step Home Assistant
        res_ha = await flow.async_step_home_assistant({"location_name": "Maison"})
        self.assertEqual(res_ha["type"], "create_entry")
        self.assertEqual(res_ha["data"]["latitude"], 48.85)
        self.assertEqual(res_ha["data"]["longitude"], 2.35)

        # Step Manual
        res_man = await flow.async_step_manual({
            "location_name": "Bureau",
            "latitude": 45.75,
            "longitude": 4.85,
        })
        self.assertEqual(res_man["type"], "create_entry")
        self.assertEqual(res_man["data"]["latitude"], 45.75)
        self.assertEqual(res_man["data"]["longitude"], 4.85)


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

            aqi = await api.get_air_quality()
            self.assertIsNotNone(aqi)
            self.assertIn("current", aqi)



if __name__ == "__main__":
    unittest.main()

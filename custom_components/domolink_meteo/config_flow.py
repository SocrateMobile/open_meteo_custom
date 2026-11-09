"""Flux de configuration et options pour Open-Meteo Custom."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_CARTO_API_KEY,
    CONF_ENABLE_AIR_QUALITY,
    CONF_LOCATION_NAME,
    CONF_POSTAL_CODE,
    CONF_SHOW_SIDEBAR_PANEL,
    CONF_UPDATE_INTERVAL,
    CONF_WIND_GUST_THRESHOLD,
    DEFAULT_CARTO_API_KEY,
    DEFAULT_ENABLE_AIR_QUALITY,
    DEFAULT_SHOW_SIDEBAR_PANEL,
    DEFAULT_UPDATE_INTERVAL,
    DEFAULT_WIND_GUST_THRESHOLD,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

TIMEOUT = aiohttp.ClientTimeout(total=10)


async def async_geocode_postal_code(hass: HomeAssistant, postal_code: str) -> dict[str, Any] | None:
    """Convertit un code postal français en coordonnées via l'API BAN."""
    url = "https://api-adresse.data.gouv.fr/search/"
    params = {
        "q": postal_code,
        "type": "municipality",
        "limit": 1,
    }

    try:
        session = async_get_clientsession(hass)
        async with session.get(url, params=params, timeout=TIMEOUT) as response:
            if response.status != 200:
                return None
            data = await response.json()
            features = data.get("features", [])
            if not features:
                return None

            coords = features[0].get("geometry", {}).get("coordinates", [])
            if len(coords) < 2:
                return None

            city = features[0].get("properties", {}).get("city") or features[0].get("properties", {}).get("nom")

            return {
                CONF_LATITUDE: round(float(coords[1]), 4),
                CONF_LONGITUDE: round(float(coords[0]), 4),
                "city": city or postal_code,
            }
    except Exception as err:
        _LOGGER.warning("Erreur lors du géocodage du code postal %s: %s", postal_code, err)
        return None


class OpenMeteoCustomConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Gère le flux de configuration pour Open-Meteo Custom."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Retourne le flux d'options."""
        return OpenMeteoOptionsFlow(config_entry)

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Étape initiale : choix du mode de localisation."""
        return self.async_show_menu(
            step_id="user",
            menu_options=["postal", "home_assistant", "manual"],
        )

    async def async_step_postal(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Saisie par code postal (France)."""
        errors: dict[str, str] = {}

        if user_input is not None:
            postal_code = user_input[CONF_POSTAL_CODE].strip()
            coords = await async_geocode_postal_code(self.hass, postal_code)
            if coords:
                lat = coords[CONF_LATITUDE]
                lon = coords[CONF_LONGITUDE]
                city = coords.get("city", postal_code)

                await self.async_set_unique_id(f"{DOMAIN}_{lat}_{lon}")
                self._abort_if_unique_id_configured()

                title = f"Open-Meteo {city} ({postal_code})"
                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_POSTAL_CODE: postal_code,
                        CONF_LOCATION_NAME: city,
                        CONF_LATITUDE: lat,
                        CONF_LONGITUDE: lon,
                    },
                )
            errors["base"] = "invalid_postal_code"

        schema = vol.Schema({vol.Required(CONF_POSTAL_CODE): cv.string})
        return self.async_show_form(step_id="postal", data_schema=schema, errors=errors)

    async def async_step_home_assistant(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Utilise les coordonnées configurées dans Home Assistant."""
        lat = round(float(self.hass.config.latitude), 4)
        lon = round(float(self.hass.config.longitude), 4)
        name = self.hass.config.location_name or "Home"

        if user_input is not None:
            await self.async_set_unique_id(f"{DOMAIN}_{lat}_{lon}")
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title=f"Open-Meteo {name}",
                data={
                    CONF_LOCATION_NAME: name,
                    CONF_LATITUDE: lat,
                    CONF_LONGITUDE: lon,
                },
            )

        schema = vol.Schema({
            vol.Optional(CONF_LOCATION_NAME, default=name): cv.string,
        })
        return self.async_show_form(
            step_id="home_assistant",
            data_schema=schema,
            description_placeholders={"lat": str(lat), "lon": str(lon)},
        )

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Saisie manuelle des coordonnées."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                lat = round(float(user_input[CONF_LATITUDE]), 4)
                lon = round(float(user_input[CONF_LONGITUDE]), 4)
                name = user_input.get(CONF_LOCATION_NAME, f"{lat}, {lon}").strip()

                await self.async_set_unique_id(f"{DOMAIN}_{lat}_{lon}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=f"Open-Meteo {name}",
                    data={
                        CONF_LOCATION_NAME: name,
                        CONF_LATITUDE: lat,
                        CONF_LONGITUDE: lon,
                    },
                )
            except (ValueError, TypeError):
                errors["base"] = "invalid_coordinates"

        schema = vol.Schema({
            vol.Required(CONF_LOCATION_NAME, default="Lieu personnalisé"): cv.string,
            vol.Required(CONF_LATITUDE, default=self.hass.config.latitude): cv.latitude,
            vol.Required(CONF_LONGITUDE, default=self.hass.config.longitude): cv.longitude,
        })
        return self.async_show_form(step_id="manual", data_schema=schema, errors=errors)


class OpenMeteoOptionsFlow(config_entries.OptionsFlow):
    """Gestion des options pour Open-Meteo Custom."""

    def __init__(self, config_entry: config_entries.ConfigEntry | None = None) -> None:
        """Initialise le flux d'options."""
        if config_entry is not None:
            self._config_entry = config_entry

    @property
    def _entry(self) -> config_entries.ConfigEntry:
        """Retourne l'entrée de configuration de manière sûre sur toutes les versions de HA."""
        if getattr(self, "_config_entry", None) is not None:
            return self._config_entry
        try:
            return self.config_entry
        except Exception:
            pass
        if hasattr(self, "hass") and self.hass and hasattr(self, "handler"):
            return self.hass.config_entries.async_get_entry(self.handler)
        return getattr(self, "_config_entry", None)

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Formulaire de réglage des options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        entry = self._entry
        curr_interval = entry.options.get(
            CONF_UPDATE_INTERVAL,
            entry.data.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
        ) if entry else DEFAULT_UPDATE_INTERVAL

        curr_aqi = entry.options.get(
            CONF_ENABLE_AIR_QUALITY,
            entry.data.get(CONF_ENABLE_AIR_QUALITY, DEFAULT_ENABLE_AIR_QUALITY),
        ) if entry else DEFAULT_ENABLE_AIR_QUALITY

        curr_panel = entry.options.get(
            CONF_SHOW_SIDEBAR_PANEL,
            entry.data.get(CONF_SHOW_SIDEBAR_PANEL, DEFAULT_SHOW_SIDEBAR_PANEL),
        ) if entry else DEFAULT_SHOW_SIDEBAR_PANEL

        curr_wind = entry.options.get(
            CONF_WIND_GUST_THRESHOLD,
            entry.data.get(CONF_WIND_GUST_THRESHOLD, DEFAULT_WIND_GUST_THRESHOLD),
        ) if entry else DEFAULT_WIND_GUST_THRESHOLD

        curr_carto = entry.options.get(
            CONF_CARTO_API_KEY,
            entry.data.get(CONF_CARTO_API_KEY, DEFAULT_CARTO_API_KEY),
        ) if entry else DEFAULT_CARTO_API_KEY

        try:
            interval_val = int(curr_interval)
            if interval_val not in (15, 30, 60):
                interval_val = 30
        except (ValueError, TypeError):
            interval_val = 30

        try:
            wind_val = float(curr_wind)
        except (ValueError, TypeError):
            wind_val = DEFAULT_WIND_GUST_THRESHOLD

        schema = vol.Schema({
            vol.Required(
                CONF_UPDATE_INTERVAL,
                default=interval_val,
            ): vol.In({
                15: "15 minutes",
                30: "30 minutes (recommandé)",
                60: "60 minutes (1 heure)",
            }),
            vol.Required(
                CONF_ENABLE_AIR_QUALITY,
                default=bool(curr_aqi),
            ): cv.boolean,
            vol.Required(
                CONF_SHOW_SIDEBAR_PANEL,
                default=bool(curr_panel),
            ): cv.boolean,
            vol.Required(
                CONF_WIND_GUST_THRESHOLD,
                default=wind_val,
            ): vol.Coerce(float),
            vol.Optional(
                CONF_CARTO_API_KEY,
                default=str(curr_carto or ""),
            ): cv.string,
        })

        return self.async_show_form(step_id="init", data_schema=schema)
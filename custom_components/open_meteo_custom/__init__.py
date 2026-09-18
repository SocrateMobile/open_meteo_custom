"""Intégration Open-Meteo Custom pour Home Assistant."""
from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
import os
from typing import Any

from homeassistant.components import frontend
try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:
    StaticPathConfig = None

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import OpenMeteoApi
from .const import (
    CONF_ENABLE_AIR_QUALITY,
    CONF_SHOW_SIDEBAR_PANEL,
    CONF_UPDATE_INTERVAL,
    DEFAULT_ENABLE_AIR_QUALITY,
    DEFAULT_SHOW_SIDEBAR_PANEL,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
    FRONTEND_FILE_NAME,
    FRONTEND_URL_PATH,
    PANEL_ICON,
    PANEL_NAME,
    PANEL_TITLE,
    PANEL_URL_PATH,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.WEATHER, Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_register_frontend_and_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Enregistre le chemin statique et le panneau latéral dans Home Assistant."""
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
    if os.path.exists(frontend_dir):
        if hasattr(hass.http, "async_register_static_paths") and StaticPathConfig is not None:
            try:
                await hass.http.async_register_static_paths(
                    [StaticPathConfig(FRONTEND_URL_PATH, frontend_dir, cache_headers=False)]
                )
            except Exception as err:
                _LOGGER.debug("Chemin statique déjà enregistré ou erreur: %s", err)
        elif hasattr(hass.http, "register_static_path"):
            try:
                hass.http.register_static_path(FRONTEND_URL_PATH, frontend_dir, cache_headers=False)
            except Exception as err:
                _LOGGER.debug("Chemin statique déjà enregistré ou erreur: %s", err)

    show_panel = entry.options.get(
        CONF_SHOW_SIDEBAR_PANEL,
        entry.data.get(CONF_SHOW_SIDEBAR_PANEL, DEFAULT_SHOW_SIDEBAR_PANEL),
    )

    if show_panel:
        module_url = f"{FRONTEND_URL_PATH}/{FRONTEND_FILE_NAME}?v={VERSION}"
        try:
            frontend.async_register_built_in_panel(
                hass,
                component_name="custom",
                sidebar_title=PANEL_TITLE,
                sidebar_icon=PANEL_ICON,
                frontend_url_path=PANEL_URL_PATH,
                config={
                    "_panel_custom": {
                        "name": PANEL_NAME,
                        "module_url": module_url,
                    }
                },
                require_admin=False,
                update=True,
            )
            _LOGGER.info("Open-Meteo: Panneau latéral activé et enregistré avec succès.")
        except Exception as err:
            _LOGGER.debug("Panneau latéral Open-Meteo déjà enregistré: %s", err)
    else:
        try:
            frontend.async_remove_panel(hass, PANEL_URL_PATH)
            _LOGGER.info("Open-Meteo: Panneau latéral masqué selon les options.")
        except Exception as err:
            _LOGGER.debug("Impossible de retirer le panneau latéral Open-Meteo: %s", err)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configure l'entrée de l'intégration à partir du flux de configuration."""
    try:
        latitude = float(entry.data[CONF_LATITUDE])
        longitude = float(entry.data[CONF_LONGITUDE])
    except (KeyError, TypeError, ValueError) as err:
        _LOGGER.error("Erreur critique: coordonnées latitude/longitude invalides: %s", err)
        return False

    api = OpenMeteoApi(hass, latitude, longitude)

    def get_update_interval() -> timedelta:
        minutes = entry.options.get(
            CONF_UPDATE_INTERVAL,
            entry.data.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
        )
        try:
            return timedelta(minutes=int(minutes))
        except (ValueError, TypeError):
            return timedelta(minutes=DEFAULT_UPDATE_INTERVAL)

    async def async_update_data() -> dict[str, Any]:
        """Récupération concurrente des données météo et qualité de l'air."""
        enable_aqi = entry.options.get(
            CONF_ENABLE_AIR_QUALITY,
            entry.data.get(CONF_ENABLE_AIR_QUALITY, DEFAULT_ENABLE_AIR_QUALITY),
        )

        tasks = [api.get_forecast()]
        if enable_aqi:
            tasks.append(api.get_air_quality())

        results = await asyncio.gather(*tasks, return_exceptions=True)

        forecast_data = results[0]
        if isinstance(forecast_data, Exception) or forecast_data is None:
            raise UpdateFailed(f"Échec de récupération des données météo Open-Meteo: {forecast_data}")

        air_quality_data = {}
        if enable_aqi and len(results) > 1:
            aq_res = results[1]
            if isinstance(aq_res, Exception) or aq_res is None:
                _LOGGER.warning("Qualité de l'air temporairement indisponible: %s", aq_res)
            else:
                air_quality_data = aq_res

        return {
            "forecast": forecast_data,
            "air_quality": air_quality_data,
        }

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=f"{DOMAIN}_{entry.title}",
        update_method=async_update_data,
        update_interval=get_update_interval(),
    )

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Enregistrer le panneau latéral
    await async_register_frontend_and_panel(hass, entry)

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Recharge l'entrée suite à un changement d'options."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Décharge l'entrée de l'intégration lors de sa suppression."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            try:
                frontend.async_remove_panel(hass, PANEL_URL_PATH)
            except Exception:
                pass

    return unload_ok
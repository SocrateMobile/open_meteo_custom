"""Intégration Open-Meteo Custom pour Home Assistant."""
from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import OpenMeteoApi
from .const import (
    CONF_ENABLE_AIR_QUALITY,
    CONF_UPDATE_INTERVAL,
    DEFAULT_ENABLE_AIR_QUALITY,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.WEATHER, Platform.SENSOR]


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

    return unload_ok
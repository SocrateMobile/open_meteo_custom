# ☀️ Open-Meteo Custom pour Home Assistant

## Intégration Météo Personnalisée Basée sur Open-Meteo

Cette intégration personnalisée pour Home Assistant vous permet de récupérer des données météorologiques précises et localisées pour une zone spécifique en France, en utilisant l'API gratuite Open-Meteo pour les prévisions et l'API Base Adresse Nationale (BAN) pour la géolocalisation par code postal.

---

## ✨ Fonctionnalités

* **Données Météo Actuelles :** Température, humidité, pression atmosphérique, vitesse et direction du vent, condition météo.
* **Prévisions Quotidiennes :** Températures maximales/minimales, somme des précipitations, condition météo pour les 7 prochains jours.
* **Prévisions Horaires :** Température, probabilité de précipitation, condition météo pour les prochaines heures.
* **Géolocalisation Facile :** Configurez votre intégration simplement en entrant un code postal français.
* **Multilingue :** Support de plusieurs langues pour le flux de configuration (Français, Anglais, Allemand, Italien).
* **Icônes Personnalisées :** Une interface utilisateur agréable avec des icônes spécifiques à l'intégration.

---

## 🚀 Prérequis

* Home Assistant version 2023.x ou supérieure.
* Accès au système de fichiers de Home Assistant (via Samba Share, Studio Code Server Add-on, ou SSH).

---

## 🛠️ Installation

1.  **Créez le dossier de l'intégration :**
    * Via votre explorateur de fichiers (Samba, Studio Code Server), naviguez jusqu'au dossier `config/custom_components/`.
    * Créez un nouveau dossier nommé `open_meteo_custom` (tout en minuscules).

2.  **Copiez les fichiers de l'intégration :**
    * Téléchargez tous les fichiers de ce dépôt GitHub (`__init__.py`, `api.py`, `config_flow.py`, `const.py`, `manifest.json`, `weather.py`).
    * Placez-les dans le dossier `config/custom_components/open_meteo_custom/` que vous venez de créer.

3.  **Créez le dossier et les fichiers de traduction :**
    * Dans le dossier `config/custom_components/open_meteo_custom/`, créez un nouveau dossier nommé `translations`.
    * Copiez-y les fichiers `de.json`, `en.json`, `fr.json`, `it.json` que vous trouverez dans le dossier `translations` de ce dépôt GitHub.

4.  **Ajoutez les icônes (facultatif mais recommandé) :**
    * Téléchargez `logo.png` et `icon.png` depuis la racine de ce dépôt GitHub.
    * Placez-les directement dans le dossier `config/custom_components/open_meteo_custom/`.

5.  **Redémarrez Home Assistant :**
    * Allez dans **Paramètres** > **Système** > **Redémarrer**.

---

## ⚙️ Configuration

1.  Après le redémarrage de Home Assistant, allez dans **Paramètres** > **Appareils et Services**.
2.  Cliquez sur le bouton **AJOUTER L'INTÉGRATION** en bas à droite.
3.  Recherchez "Open-Meteo Custom" ou "Météo Personnalisée Open-Meteo".
4.  Suivez les instructions du flux de configuration :
    * **Code Postal :** Saisissez un code postal français (par exemple, `75001` pour Paris).
    * L'intégration utilisera l'API Base Adresse Nationale pour géocoder ce code postal en latitude et longitude, puis configurera l'intégration météo.

5.  Si la configuration est réussie, une nouvelle entité météo `weather.open_meteo_custom_xxxxx` (où `xxxxx` est votre code postal) sera créée.

---

## 📊 Utilisation

Une fois configurée, l'entité météo sera disponible dans Home Assistant. Vous pourrez l'ajouter à vos tableaux de bord (Lovelace) en utilisant la carte météo standard.

### Exemple de configuration de carte Lovelace :

```yaml
type: weather-forecast
entity: weather.open_meteo_custom_75001 # Remplacez par votre code postal
show_forecast: true
secondary_info: temperature

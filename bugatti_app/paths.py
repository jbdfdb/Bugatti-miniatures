"""Chemins centralisés de l'application.

Tout est dérivé de la racine du dépôt pour que l'app fonctionne quel que soit
le répertoire de lancement.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent

# Données versionnées (dans le dépôt)
DATA = BASE / "data"
COLLECTION_FILE = DATA / "collection.json"       # source de vérité de la collection
CONTENT_FILE = DATA / "site_content.json"         # textes éditoriaux
RESET_FILE = DATA / "admin_reset.json"            # compteur de reset distant (versionné)
BACKUPS = DATA / "backups"                        # sauvegardes locales (non versionné)

# Configuration versionnée
CONFIG = BASE / "config"
EXCLUDE_FILE = CONFIG / "analytics_exclude.json"  # IP exclues du dashboard

# Instance locale — JAMAIS versionnée (voir .gitignore)
INSTANCE = BASE / "instance"
SECRET_FILE = INSTANCE / "admin_secret.json"      # hash du mot de passe admin
SESSION_KEY_FILE = INSTANCE / "session_key"       # clé HMAC des cookies de session
ANALYTICS_FILE = INSTANCE / "analytics.jsonl"     # journal de fréquentation
ANALYTICS_SALT_FILE = INSTANCE / "analytics_salt"  # sel d'anonymisation des IP
RESET_STATE_FILE = INSTANCE / "reset_state.json"  # dernier reset_id appliqué

# Ressources statiques
STATIC = BASE / "static"
TEMPLATES = BASE / "templates"
UPLOAD_DIR = STATIC / "img" / "uploads"
TYPES_DIR = STATIC / "img" / "types"
PHOTOS_INDEX = STATIC / "img" / "photos_index.json"


def ensure_dirs() -> None:
    """Crée les répertoires nécessaires au premier lancement."""
    for d in (DATA, BACKUPS, CONFIG, INSTANCE, UPLOAD_DIR, TYPES_DIR):
        d.mkdir(parents=True, exist_ok=True)

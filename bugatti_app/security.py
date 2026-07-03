"""Authentification admin et sécurité.

- Mot de passe haché avec scrypt (stdlib) + sel aléatoire, stocké hors dépôt.
- Session = cookie signé HMAC-SHA256 (aucune dépendance externe, aucun état
  serveur). Le cookie porte un jeton CSRF.
- Anti-force-brute sur le login (fenêtre glissante en mémoire).
- Reset distant : un compteur versionné permet à l'auteur de forcer la
  recréation du mot de passe via GitHub, sans jamais exposer de hash.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from . import paths

# Paramètres scrypt (coût mémoire/CPU raisonnable pour un login interactif).
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}
# Limite mémoire OpenSSL (le défaut de 32 Mo est trop juste pour n=2**14).
_MAXMEM = 64 * 1024 * 1024

SESSION_TTL = 12 * 3600          # durée de vie d'une session admin (secondes)
COOKIE_NAME = "bugatti_admin"

# Anti-force-brute
_MAX_ATTEMPTS = 8                # essais autorisés…
_WINDOW = 300                    # …par fenêtre de 5 minutes / par IP
_attempts: dict[str, list[float]] = {}


# ─────────────────────────────── Mot de passe ───────────────────────────────

def is_password_set() -> bool:
    return paths.SECRET_FILE.exists()


def _write_secret(obj: dict) -> None:
    paths.INSTANCE.mkdir(parents=True, exist_ok=True)
    with open(paths.SECRET_FILE, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    try:
        os.chmod(paths.SECRET_FILE, 0o600)
    except OSError:
        pass


def set_password(password: str) -> None:
    if not password or len(password) < 6:
        raise ValueError("Le mot de passe doit contenir au moins 6 caractères.")
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, maxmem=_MAXMEM, **_SCRYPT)
    _write_secret({
        "salt": salt.hex(),
        "hash": dk.hex(),
        "params": _SCRYPT,
        "created": int(time.time()),
    })


def verify_password(password: str) -> bool:
    if not is_password_set():
        return False
    try:
        with open(paths.SECRET_FILE, encoding="utf-8") as f:
            rec = json.load(f)
        salt = bytes.fromhex(rec["salt"])
        expected = bytes.fromhex(rec["hash"])
        params = rec.get("params", _SCRYPT)
        dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, maxmem=_MAXMEM, **params)
    except (OSError, ValueError, KeyError):
        return False
    return hmac.compare_digest(dk, expected)


# ───────────────────────────── Reset distant ────────────────────────────────

def apply_forced_reset() -> None:
    """Si le reset_id versionné dépasse celui déjà appliqué, efface le mot de
    passe pour forcer sa recréation. Appelé au démarrage."""
    try:
        with open(paths.RESET_FILE, encoding="utf-8") as f:
            wanted = int(json.load(f).get("reset_id", 0))
    except (OSError, ValueError, KeyError):
        return
    applied = 0
    if paths.RESET_STATE_FILE.exists():
        try:
            with open(paths.RESET_STATE_FILE, encoding="utf-8") as f:
                applied = int(json.load(f).get("applied_id", 0))
        except (OSError, ValueError, KeyError):
            applied = 0
    if wanted > applied:
        if paths.SECRET_FILE.exists():
            paths.SECRET_FILE.unlink()
        rotate_session_key()  # révoque aussi toute session encore active
        paths.INSTANCE.mkdir(parents=True, exist_ok=True)
        with open(paths.RESET_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"applied_id": wanted}, f)


def reset_password_local() -> None:
    """Efface le mot de passe local (utilisé par `bugatti reset-admin`)."""
    if paths.SECRET_FILE.exists():
        paths.SECRET_FILE.unlink()


# ─────────────────────────── Clé de session HMAC ────────────────────────────

def _session_key() -> bytes:
    if paths.SESSION_KEY_FILE.exists():
        return paths.SESSION_KEY_FILE.read_bytes()
    paths.INSTANCE.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    paths.SESSION_KEY_FILE.write_bytes(key)
    try:
        os.chmod(paths.SESSION_KEY_FILE, 0o600)
    except OSError:
        pass
    return key


def rotate_session_key() -> None:
    """Génère une nouvelle clé de signature : invalide immédiatement tous les
    cookies de session existants (utilisé au changement de mot de passe et au
    reset). N'affecte pas l'anonymisation analytics, qui a son propre sel."""
    if paths.SESSION_KEY_FILE.exists():
        paths.SESSION_KEY_FILE.unlink()
    _session_key()


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(txt: str) -> bytes:
    pad = "=" * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


# ─────────────────────────── Jetons de session ──────────────────────────────

def make_session() -> str:
    """Crée un cookie signé pour une session admin fraîche."""
    payload = {"csrf": secrets.token_hex(16), "exp": int(time.time()) + SESSION_TTL}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_session_key(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64e(sig)}"


def read_session(token: str | None) -> dict | None:
    """Vérifie signature + expiration. Renvoie le payload ou None."""
    if not token or "." not in token:
        return None
    body, _, sig = token.partition(".")
    try:
        expected = hmac.new(_session_key(), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64d(sig)):
            return None
        payload = json.loads(_b64d(body))
    except (ValueError, KeyError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    return payload


def check_csrf(payload: dict | None, token: str | None) -> bool:
    if not payload or not token:
        return False
    return hmac.compare_digest(str(payload.get("csrf", "")), str(token))


# ──────────────────────────── Anti-force-brute ──────────────────────────────

def register_attempt(ip: str) -> None:
    now = time.time()
    hist = [t for t in _attempts.get(ip, []) if now - t < _WINDOW]
    hist.append(now)
    _attempts[ip] = hist


def is_locked(ip: str) -> bool:
    now = time.time()
    hist = [t for t in _attempts.get(ip, []) if now - t < _WINDOW]
    _attempts[ip] = hist
    return len(hist) >= _MAX_ATTEMPTS


def clear_attempts(ip: str) -> None:
    _attempts.pop(ip, None)

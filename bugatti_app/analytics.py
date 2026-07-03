"""Fréquentation du site — journal local et agrégats pour le dashboard admin.

Vie privée : on n'enregistre jamais l'IP en clair. L'IP sert uniquement, à
l'ingestion, à (1) exclure les visiteurs configurés (Pascal, J-B, localhost)
et (2) calculer un identifiant anonyme (HMAC de l'IP) pour compter les
visiteurs uniques. Le journal est local et non versionné.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import Counter

from . import paths

_LOCK = threading.Lock()

# Au-delà de cette taille, on cesse d'enregistrer (garde-fou anti-remplissage
# de disque si le site est public et inondé de requêtes).
_MAX_LOG_BYTES = 25 * 1024 * 1024


def _salt() -> bytes:
    """Sel persistant, propre aux analytics (indépendant de la clé de session,
    pour que sa rotation ne casse pas le comptage des visiteurs uniques)."""
    if paths.ANALYTICS_SALT_FILE.exists():
        return paths.ANALYTICS_SALT_FILE.read_bytes()
    paths.INSTANCE.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_bytes(32)
    paths.ANALYTICS_SALT_FILE.write_bytes(salt)
    try:
        os.chmod(paths.ANALYTICS_SALT_FILE, 0o600)
    except OSError:
        pass
    return salt


def _excluded_ips() -> set[str]:
    try:
        with open(paths.EXCLUDE_FILE, encoding="utf-8") as f:
            return set(json.load(f).get("ips", []))
    except (OSError, ValueError):
        return set()


def load_excluded() -> list[str]:
    try:
        with open(paths.EXCLUDE_FILE, encoding="utf-8") as f:
            return list(json.load(f).get("ips", []))
    except (OSError, ValueError):
        return []


def save_excluded(ips: list[str]) -> None:
    cleaned = sorted({ip.strip() for ip in ips if ip.strip()})
    with _LOCK:
        with open(paths.EXCLUDE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "ips": cleaned,
                "comment": "IP à exclure du dashboard de fréquentation.",
            }, f, ensure_ascii=False, indent=2)


def _anon(ip: str) -> str:
    return hmac.new(_salt(), ip.encode("utf-8"),
                    hashlib.sha256).hexdigest()[:16]


def record_visit(ip: str, path: str, is_admin: bool) -> None:
    """Enregistre une visite de page, sauf IP exclue ou session admin."""
    if is_admin or not ip or ip in _excluded_ips():
        return
    try:
        if paths.ANALYTICS_FILE.exists() and paths.ANALYTICS_FILE.stat().st_size > _MAX_LOG_BYTES:
            return  # journal plein : on arrête d'écrire plutôt que de saturer le disque
    except OSError:
        pass
    entry = {"ts": int(time.time()), "path": path, "v": _anon(ip)}
    line = json.dumps(entry, ensure_ascii=False)
    with _LOCK:
        paths.INSTANCE.mkdir(parents=True, exist_ok=True)
        with open(paths.ANALYTICS_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def summary(days: int = 30) -> dict:
    """Agrège le journal pour le dashboard."""
    now = time.time()
    since = now - days * 86400
    per_day: Counter = Counter()
    paths_counter: Counter = Counter()
    visitors: set[str] = set()
    visitors_window: set[str] = set()
    total = 0
    total_window = 0

    if paths.ANALYTICS_FILE.exists():
        with open(paths.ANALYTICS_FILE, encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    e = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                total += 1
                visitors.add(e.get("v", ""))
                if e.get("ts", 0) >= since:
                    total_window += 1
                    visitors_window.add(e.get("v", ""))
                    day = time.strftime("%Y-%m-%d", time.localtime(e["ts"]))
                    per_day[day] += 1
                    paths_counter[e.get("path", "/")] += 1

    # Série continue sur `days` jours (jours sans visite = 0)
    series = []
    for i in range(days - 1, -1, -1):
        day = time.strftime("%Y-%m-%d", time.localtime(now - i * 86400))
        series.append({"date": day, "count": per_day.get(day, 0)})

    return {
        "total_visits": total,
        "unique_visitors": len(visitors),
        "window_days": days,
        "window_visits": total_window,
        "window_unique": len(visitors_window),
        "series": series,
        "top_paths": paths_counter.most_common(10),
        "excluded_ips": load_excluded(),
    }

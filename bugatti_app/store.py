"""Stockage vivant de la collection et des textes du site.

`data/collection.json` est la source de vérité : une liste de miniatures.
Toutes les écritures sont atomiques (fichier temporaire puis renommage) et
précédées d'une sauvegarde horodatée dans `data/backups/`.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
from typing import Any

from . import paths

# Verrou process : sérialise les écritures concurrentes sur les fichiers JSON.
_LOCK = threading.RLock()

# Champs éditables d'une miniature (liste blanche — aucune autre clé acceptée).
EDITABLE_FIELDS = [
    "fabricant", "ref", "serie", "marque", "type_bugatti", "modele",
    "chassis", "annee", "couleur", "echelle", "type_miniature",
    "annee_miniature", "remarques", "source_photo", "source_info", "montage",
]

# Colonnes CSV : (clé interne, en-tête lisible). L'ordre définit « la forme exacte ».
CSV_COLUMNS: list[tuple[str, str]] = [
    ("id", "id"),
    ("fabricant", "Fabricant"),
    ("ref", "Référence"),
    ("serie", "Série/Quantité"),
    ("marque", "Marque"),
    ("type_bugatti", "Type Bugatti"),
    ("modele", "Modèle"),
    ("chassis", "Châssis"),
    ("annee", "Année véhicule"),
    ("couleur", "Couleur"),
    ("echelle", "Échelle"),
    ("type_miniature", "Matériau"),
    ("annee_miniature", "Année miniature"),
    ("remarques", "Remarques"),
    ("source_photo", "Source photo"),
    ("source_info", "Source info"),
    ("montage", "Montage"),
]
CSV_HEADERS = [h for _, h in CSV_COLUMNS]

MAX_FIELD_LEN = 2000  # garde-fou anti-abus sur la longueur d'un champ


# ─────────────────────────── Lecture / écriture bas niveau ──────────────────

def _read_json(path, default):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _atomic_write_json(path, obj) -> None:
    """Écrit du JSON de façon atomique (temp + rename) dans le même répertoire."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# Alias public : l'app s'en sert pour écrire l'index des photos de façon atomique.
atomic_write_json = _atomic_write_json


def _backup(path, tag: str) -> None:
    """Copie horodatée d'un fichier avant modification."""
    if not path.exists():
        return
    paths.BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = paths.BACKUPS / f"{tag}-{stamp}{path.suffix}"
    shutil.copy2(path, dest)
    _prune_backups(tag, keep=30)


def _prune_backups(tag: str, keep: int) -> None:
    """Ne conserve que les `keep` dernières sauvegardes d'un type donné."""
    backups = sorted(paths.BACKUPS.glob(f"{tag}-*"))
    for old in backups[:-keep]:
        try:
            old.unlink()
        except OSError:
            pass


# ─────────────────────────────── Collection ─────────────────────────────────

def _type_number(type_bugatti: Any) -> str:
    m = re.match(r"^(\d+)", str(type_bugatti or ""))
    return m.group(1) if m else ""


def _normalize_echelle(value: str) -> str:
    """Accepte « 43 » ou « 1/43 » et renvoie toujours « 1/43 »."""
    value = str(value).strip()
    if not value:
        return ""
    if value.startswith("1/"):
        return value
    if value.isdigit():
        return f"1/{value}"
    return value


def load_collection() -> list[dict]:
    with _LOCK:
        return _read_json(paths.COLLECTION_FILE, [])


def _save_collection(miniatures: list[dict]) -> None:
    with _LOCK:
        _backup(paths.COLLECTION_FILE, "collection")
        _atomic_write_json(paths.COLLECTION_FILE, miniatures)


def get_miniature(mid: int) -> dict | None:
    for m in load_collection():
        if m.get("id") == mid:
            return m
    return None


def update_miniature_field(mid: int, field: str, value: str) -> dict:
    """Met à jour un champ d'une miniature. Renvoie la miniature mise à jour."""
    if field not in EDITABLE_FIELDS:
        raise ValueError(f"Champ non éditable : {field}")
    value = ("" if value is None else str(value)).strip()[:MAX_FIELD_LEN]
    with _LOCK:
        miniatures = load_collection()
        for m in miniatures:
            if m.get("id") == mid:
                if field == "echelle":
                    value = _normalize_echelle(value)
                if value == "":
                    m.pop(field, None)
                else:
                    m[field] = value
                if field == "type_bugatti":
                    m["type_number"] = _type_number(value)
                _save_collection(miniatures)
                return m
        raise KeyError(f"Miniature introuvable : {mid}")


def add_miniature() -> dict:
    """Crée une miniature vierge et renvoie son enregistrement."""
    with _LOCK:
        miniatures = load_collection()
        new_id = (max((m.get("id", 0) for m in miniatures), default=0)) + 1
        entry = {"id": new_id, "type_bugatti": "", "type_number": ""}
        miniatures.append(entry)
        _save_collection(miniatures)
        return entry


def delete_miniature(mid: int) -> bool:
    with _LOCK:
        miniatures = load_collection()
        kept = [m for m in miniatures if m.get("id") != mid]
        if len(kept) == len(miniatures):
            return False
        _save_collection(kept)
        return True


# ─────────────────────────────── Statistiques ───────────────────────────────

def compute_stats(miniatures: list[dict]) -> dict:
    """Agrégats affichés par le site (portés depuis l'ancien convert_data.py)."""
    fabricants_count: dict[str, int] = {}
    types_count: dict[str, int] = {}
    materials_count: dict[str, int] = {}
    decades: dict[str, int] = {}
    marques_count: dict[str, int] = {}

    for m in miniatures:
        fab = m.get("fabricant") or "Inconnu"
        fabricants_count[fab] = fabricants_count.get(fab, 0) + 1

        tn = m.get("type_number") or _type_number(m.get("type_bugatti"))
        if tn:
            types_count[tn] = types_count.get(tn, 0) + 1

        mat = m.get("type_miniature") or "Non spécifié"
        materials_count[mat] = materials_count.get(mat, 0) + 1

        annee = str(m.get("annee_miniature", ""))
        if annee.isdigit() and len(annee) >= 3:
            decade = f"{annee[:3]}0s"
            decades[decade] = decades.get(decade, 0) + 1

        marque = m.get("marque") or "Bugatti"
        marques_count[marque] = marques_count.get(marque, 0) + 1

    return {
        "total": len(miniatures),
        "fabricants": len(fabricants_count),
        "types": len(types_count),
        "top_fabricants": sorted(fabricants_count.items(), key=lambda x: -x[1])[:50],
        "top_types": sorted(types_count.items(), key=lambda x: -x[1])[:40],
        "materials": sorted(materials_count.items(), key=lambda x: -x[1]),
        "decades": sorted(decades.items()),
        "marques": sorted(marques_count.items(), key=lambda x: -x[1]),
    }


# ───────────────────────────── Textes du site ───────────────────────────────

def load_content() -> dict:
    return _read_json(paths.CONTENT_FILE, {})


def update_content(key: str, value: str) -> dict:
    content = load_content()
    if key not in content:
        raise KeyError(f"Texte inconnu : {key}")
    with _LOCK:
        _backup(paths.CONTENT_FILE, "content")
        content[key] = ("" if value is None else str(value)).strip()[:MAX_FIELD_LEN]
        _atomic_write_json(paths.CONTENT_FILE, content)
    return content


# ──────────────────────────────── CSV ───────────────────────────────────────

def export_csv() -> str:
    """Sérialise toute la collection en CSV (forme exacte, en-têtes stables)."""
    miniatures = sorted(load_collection(), key=lambda m: m.get("id", 0))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_HEADERS)
    for m in miniatures:
        writer.writerow([m.get(key, "") for key, _ in CSV_COLUMNS])
    return buf.getvalue()


class CsvImportError(Exception):
    """Erreur de validation d'un import CSV."""


def import_csv(text: str) -> dict:
    """Remplace la collection à partir d'un CSV respectant la forme exacte.

    Valide les en-têtes au caractère près, reconstruit chaque miniature,
    sauvegarde l'ancienne version puis écrit de façon atomique.
    Renvoie un résumé {imported, created, updated}.
    """
    # tolère un BOM éventuel (Excel) en tête de fichier
    if text.startswith("﻿"):
        text = text[1:]
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        raise CsvImportError("Fichier CSV vide.")

    headers = [h.strip() for h in headers]
    if headers != CSV_HEADERS:
        raise CsvImportError(
            "En-têtes CSV invalides. Attendu exactement :\n"
            + ";".join(CSV_HEADERS)
            + "\nReçu :\n" + ";".join(headers)
        )

    # ── 1re passe : lecture + validation, collecte des id explicites ─────────
    parsed: list[tuple[int, int | None, dict]] = []  # (ligne, id explicite|None, valeurs)
    explicit_ids: set[int] = set()
    for line_no, row in enumerate(reader, start=2):
        if not any(cell.strip() for cell in row):
            continue  # ligne vide
        if len(row) != len(CSV_COLUMNS):
            raise CsvImportError(
                f"Ligne {line_no} : {len(row)} colonnes au lieu de {len(CSV_COLUMNS)}."
            )
        values = {key: row[i].strip() for i, (key, _) in enumerate(CSV_COLUMNS)}
        raw_id = values.pop("id", "").strip()
        mid: int | None = None
        if raw_id:
            try:
                mid = int(raw_id)
            except ValueError:
                raise CsvImportError(f"Ligne {line_no} : id invalide « {raw_id} ».")
            if mid in explicit_ids:
                raise CsvImportError(f"Ligne {line_no} : id dupliqué « {mid} ».")
            explicit_ids.add(mid)
        parsed.append((line_no, mid, values))

    # ── 2e passe : attribution des id manquants (sans jamais entrer en
    #    collision avec un id explicite ni un id déjà attribué) ──────────────
    used_ids: set[int] = set(explicit_ids)
    next_id = (max(explicit_ids, default=0)) + 1
    result: list[dict] = []
    created = updated = 0

    for line_no, mid, values in parsed:
        if mid is None:
            while next_id in used_ids:
                next_id += 1
            mid = next_id
            created += 1
        else:
            updated += 1
        used_ids.add(mid)

        entry: dict[str, Any] = {"id": mid}
        for key, val in values.items():
            if not val:
                continue
            if len(val) > MAX_FIELD_LEN:
                raise CsvImportError(f"Ligne {line_no} : champ « {key} » trop long.")
            if key == "echelle":
                val = _normalize_echelle(val)
            entry[key] = val
        entry["type_number"] = _type_number(entry.get("type_bugatti"))
        result.append(entry)

    if not result:
        raise CsvImportError("Aucune miniature valide dans le CSV.")

    _save_collection(result)
    return {"imported": len(result), "created": created, "updated": updated}

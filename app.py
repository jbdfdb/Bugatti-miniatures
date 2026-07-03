"""Les Bugatti de Pascal — application FastAPI.

Site vitrine public + zone d'administration protégée par mot de passe
(édition inline, import/export CSV, dashboard de fréquentation).
Voir bugatti_app/ pour les modules (stockage, sécurité, analytics).
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from bugatti_app import analytics, paths, security, store

# ─────────────────────────────── Démarrage ──────────────────────────────────

paths.ensure_dirs()
security.apply_forced_reset()  # honore un reset demandé via GitHub

app = FastAPI(title="Les Bugatti de Pascal", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=paths.STATIC), name="static")
templates = Jinja2Templates(directory=str(paths.TEMPLATES))

# Cookie « secure » seulement en HTTPS (mettre BUGATTI_HTTPS=1 en production).
COOKIE_SECURE = os.environ.get("BUGATTI_HTTPS", "") == "1"
MAX_UPLOAD = 15 * 1024 * 1024  # 15 Mo (photos de téléphone haute résolution)


def detect_image(raw: bytes) -> str | None:
    """Reconnaît le format d'après les octets magiques. Renvoie l'extension."""
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return ".webp"
    return None


# ─────────────────────────── En-têtes de sécurité ───────────────────────────

@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return resp


# ──────────────────────────────── Helpers ───────────────────────────────────

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def client_ip(request: Request) -> str:
    # request.client.host reflète l'IP réelle du pair TCP. On NE lit PAS
    # X-Forwarded-For nous-mêmes (le client peut le forger, ce qui
    # contournerait l'anti-force-brute et l'exclusion analytics). La confiance
    # éventuelle en un proxy est gérée au lancement d'uvicorn (proxy-headers),
    # activée seulement via BUGATTI_TRUST_PROXY=1 dans bin/bugatti.
    return request.client.host if request.client else ""


def is_local_request(request: Request) -> bool:
    """Vrai si la requête vient de la machine elle-même (connexion loopback)."""
    peer = request.client.host if request.client else ""
    return peer in LOOPBACK


def session_of(request: Request) -> dict | None:
    return security.read_session(request.cookies.get(security.COOKIE_NAME))


def is_admin(request: Request) -> bool:
    return session_of(request) is not None


def admin_guard(request: Request) -> dict:
    """Dépendance : exige une session admin valide et, pour les requêtes
    d'écriture, un jeton CSRF correct."""
    payload = session_of(request)
    if payload is None:
        raise _json_error(401, "Non authentifié.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        token = request.headers.get("x-csrf-token")
        if not security.check_csrf(payload, token):
            raise _json_error(403, "Jeton CSRF invalide.")
    return payload


def _json_error(status: int, message: str):
    from fastapi import HTTPException
    return HTTPException(status_code=status, detail=message)


def set_session_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        security.COOKIE_NAME, token,
        max_age=security.SESSION_TTL, httponly=True,
        samesite="strict", secure=COOKIE_SECURE, path="/",
    )


async def read_json(request: Request, max_bytes: int = 64 * 1024) -> dict:
    """Lit un corps JSON en refusant les corps trop gros AVANT de les charger
    en mémoire, et en renvoyant une erreur propre si le JSON est invalide."""
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > max_bytes:
        raise _json_error(413, "Requête trop volumineuse.")
    try:
        data = await request.json()
    except Exception:
        raise _json_error(400, "Corps de requête invalide.")
    if not isinstance(data, dict):
        raise _json_error(400, "Corps de requête invalide.")
    return data


# ──────────────────────────────── Public ────────────────────────────────────

def asset_version() -> str:
    """Empreinte des fichiers JS/CSS pour forcer le navigateur à recharger
    les nouvelles versions après une mise à jour (anti-cache)."""
    files = [
        paths.STATIC / "js" / "app.js", paths.STATIC / "js" / "admin.js",
        paths.STATIC / "css" / "style.css", paths.STATIC / "css" / "admin.css",
    ]
    mtimes = [f.stat().st_mtime for f in files if f.exists()]
    return str(int(max(mtimes))) if mtimes else "1"


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    analytics.record_visit(client_ip(request), "/", is_admin(request))
    resp = templates.TemplateResponse(
        "index.html", {"request": request, "v": asset_version()})
    # La page HTML elle-même ne doit jamais être mise en cache (elle porte les
    # numéros de version des assets).
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _type_photos() -> dict:
    manifest_path = paths.TYPES_DIR / "manifest.json"
    out: dict = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for type_key, info in manifest.items():
            num = type_key.replace("type_", "")
            out[num] = {
                "url": f"/static/img/types/{info['filename']}",
                "attribution": info.get("author", "Wikimedia Commons"),
                "license": info.get("license", ""),
                "source": info.get("source_url", ""),
            }
    return out


def _uploaded_photos() -> dict:
    if paths.PHOTOS_INDEX.exists():
        return json.loads(paths.PHOTOS_INDEX.read_text(encoding="utf-8"))
    return {}


def _save_photos(index: dict) -> None:
    """Écrit l'index des photos de façon atomique (même mécanisme que la
    collection), pour ne jamais laisser un fichier tronqué."""
    store.atomic_write_json(paths.PHOTOS_INDEX, index)


def _remove_uploaded_photo(mid: int) -> None:
    """Supprime la photo uploadée d'une miniature (fichier + entrée d'index)."""
    index = _uploaded_photos()
    key = str(mid)
    if key in index:
        fp = paths.BASE / index[key]["url"].lstrip("/")
        if fp.exists():
            fp.unlink()
        del index[key]
        _save_photos(index)


@app.get("/api/data")
async def api_data(request: Request):
    """Tout ce dont le front a besoin : collection, stats, textes, photos."""
    miniatures = store.load_collection()
    return {
        "miniatures": miniatures,
        "stats": store.compute_stats(miniatures),
        "content": store.load_content(),
        "photos": {
            "miniature_photos": _uploaded_photos(),
            "type_photos": _type_photos(),
        },
        "admin": is_admin(request),
    }


@app.get("/api/session")
async def api_session(request: Request):
    payload = session_of(request)
    return {
        "admin": payload is not None,
        "csrf": payload.get("csrf") if payload else None,
        "password_set": security.is_password_set(),
    }


# ───────────────────────────── Authentification ─────────────────────────────

@app.post("/api/admin/setup")
async def admin_setup(request: Request):
    """Définit le mot de passe au tout premier lancement.

    Réservé aux requêtes locales (depuis la machine) : cela empêche, sur un
    déploiement public sans mot de passe encore défini, qu'un inconnu ne
    s'enrôle comme administrateur avant le propriétaire. Le propriétaire
    définit toujours son mot de passe en local (BUGATTI_ALLOW_REMOTE_SETUP=1
    pour lever cette restriction en connaissance de cause)."""
    allow_remote = os.environ.get("BUGATTI_ALLOW_REMOTE_SETUP", "") == "1"
    if not is_local_request(request) and not allow_remote:
        raise _json_error(403, "La création du mot de passe n'est autorisée que depuis la machine du site.")
    if security.is_password_set():
        raise _json_error(409, "Un mot de passe existe déjà.")
    body = await read_json(request)
    try:
        security.set_password(str(body.get("password", "")))
    except ValueError as e:
        raise _json_error(400, str(e))
    token = security.make_session()
    resp = JSONResponse({"ok": True, "csrf": security.read_session(token)["csrf"]})
    set_session_cookie(resp, token)
    return resp


@app.post("/api/admin/login")
async def admin_login(request: Request):
    ip = client_ip(request)
    if security.is_locked(ip):
        raise _json_error(429, "Trop de tentatives. Réessayez dans quelques minutes.")
    if not security.is_password_set():
        raise _json_error(409, "Aucun mot de passe défini. Créez-le d'abord.")
    body = await read_json(request)
    if not security.verify_password(str(body.get("password", ""))):
        security.register_attempt(ip)
        raise _json_error(401, "Mot de passe incorrect.")
    security.clear_attempts(ip)
    token = security.make_session()
    resp = JSONResponse({"ok": True, "csrf": security.read_session(token)["csrf"]})
    set_session_cookie(resp, token)
    return resp


@app.post("/api/admin/logout")
async def admin_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(security.COOKIE_NAME, path="/")
    return resp


@app.post("/api/admin/change-password")
async def change_password(request: Request, _: dict = Depends(admin_guard)):
    body = await read_json(request)
    if not security.verify_password(str(body.get("current", ""))):
        raise _json_error(401, "Mot de passe actuel incorrect.")
    try:
        security.set_password(str(body.get("new", "")))
    except ValueError as e:
        raise _json_error(400, str(e))
    # Change de mot de passe = on révoque toutes les autres sessions (rotation
    # de la clé de signature) et on redonne un cookie frais à l'admin courant.
    security.rotate_session_key()
    token = security.make_session()
    resp = JSONResponse({"ok": True, "csrf": security.read_session(token)["csrf"]})
    set_session_cookie(resp, token)
    return resp


# ─────────────────────────── Édition (protégée) ─────────────────────────────

@app.patch("/api/admin/miniature/{mid}")
async def patch_miniature(mid: int, request: Request, _: dict = Depends(admin_guard)):
    body = await read_json(request)
    try:
        updated = store.update_miniature_field(
            mid, str(body.get("field", "")), body.get("value", ""))
    except ValueError as e:
        raise _json_error(400, str(e))
    except KeyError as e:
        raise _json_error(404, str(e))
    return {"ok": True, "miniature": updated}


@app.post("/api/admin/miniature")
async def create_miniature(_: dict = Depends(admin_guard)):
    return {"ok": True, "miniature": store.add_miniature()}


@app.delete("/api/admin/miniature/{mid}")
async def remove_miniature(mid: int, _: dict = Depends(admin_guard)):
    if not store.delete_miniature(mid):
        raise _json_error(404, "Miniature introuvable.")
    _remove_uploaded_photo(mid)  # supprime aussi une éventuelle photo uploadée
    return {"ok": True}


@app.patch("/api/admin/content")
async def patch_content(request: Request, _: dict = Depends(admin_guard)):
    body = await read_json(request)
    try:
        content = store.update_content(str(body.get("key", "")), body.get("value", ""))
    except KeyError as e:
        raise _json_error(404, str(e))
    return {"ok": True, "content": content}


# ──────────────────────────────── CSV ───────────────────────────────────────

@app.get("/api/admin/export.csv")
async def export_csv(_: dict = Depends(admin_guard)):
    csv_text = store.export_csv()
    return PlainTextResponse(
        csv_text, media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="collection-bugatti.csv"'},
    )


@app.post("/api/admin/import-csv")
async def import_csv(request: Request, file: UploadFile = File(...),
                     _: dict = Depends(admin_guard)):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > 25 * 1024 * 1024:
        raise _json_error(413, "Fichier trop volumineux.")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise _json_error(413, "Fichier trop volumineux.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _json_error(400, "Le fichier doit être encodé en UTF-8.")
    try:
        result = store.import_csv(text)
    except store.CsvImportError as e:
        raise _json_error(400, str(e))
    return {"ok": True, **result}


# ──────────────────────────────── Photos ────────────────────────────────────

@app.post("/api/admin/upload-photo")
async def upload_photo(request: Request, miniature_id: int = Form(...),
                       photo: UploadFile = File(...), _: dict = Depends(admin_guard)):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_UPLOAD + 1024 * 1024:
        raise _json_error(413, "Image trop lourde (max 15 Mo).")
    raw = await photo.read()
    if len(raw) > MAX_UPLOAD:
        raise _json_error(413, "Image trop lourde (max 15 Mo).")
    ext = detect_image(raw)
    if ext is None:
        raise _json_error(400, "Format non supporté. Utilisez un JPG, un PNG ou un WebP.")

    filename = f"mini_{miniature_id}{ext}"
    # nettoie d'anciennes extensions pour cette miniature
    for old in paths.UPLOAD_DIR.glob(f"mini_{miniature_id}.*"):
        old.unlink()
    (paths.UPLOAD_DIR / filename).write_bytes(raw)

    index = _uploaded_photos()
    index[str(miniature_id)] = {"url": f"/static/img/uploads/{filename}", "source": "upload"}
    _save_photos(index)
    return {"ok": True, "url": f"/static/img/uploads/{filename}"}


@app.delete("/api/admin/photo/{mid}")
async def delete_photo(mid: int, _: dict = Depends(admin_guard)):
    _remove_uploaded_photo(mid)
    return {"ok": True}


# ─────────────────────────────── Analytics ──────────────────────────────────

@app.get("/api/admin/analytics")
async def get_analytics(_: dict = Depends(admin_guard)):
    return analytics.summary()


@app.get("/api/admin/excluded")
async def get_excluded(_: dict = Depends(admin_guard)):
    return {"ips": analytics.load_excluded()}


@app.post("/api/admin/excluded")
async def set_excluded(request: Request, _: dict = Depends(admin_guard)):
    body = await read_json(request)
    ips = body.get("ips", [])
    if not isinstance(ips, list):
        raise _json_error(400, "Format invalide.")
    analytics.save_excluded([str(x) for x in ips])
    return {"ok": True, "ips": analytics.load_excluded()}


@app.get("/api/admin/my-ip")
async def my_ip(request: Request, _: dict = Depends(admin_guard)):
    """Renvoie l'IP vue par le serveur, pour faciliter l'exclusion."""
    return {"ip": client_ip(request)}

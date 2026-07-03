# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Les Bugatti de Pascal" — a French single-page web app showcasing a collection of ~3,900 Bugatti miniature models, given as a gift to a non-developer owner (Pascal). A FastAPI backend serves a public read-only site plus a password-protected **admin zone** for inline editing, CSV import/export, and a traffic dashboard. All user-facing text is in French. The app runs locally; it is built to also be public-ready (auth, CSRF, CSP).

## Commands

```bash
# First-time setup (creates .venv, installs deps, adds the `bugatti` zsh alias)
./install.sh

# Everyday use (owner-facing CLI — see bin/bugatti)
bugatti run          # start server + open browser (http://localhost:8000)
bugatti stop         # stop
bugatti update       # git pull + refresh deps
bugatti backup       # tar collection + content + photos into data/backups/
bugatti reset-admin  # wipe local admin password

# Dev equivalent without the alias (--no-proxy-headers so X-Forwarded-For
# can't be spoofed; add BUGATTI_TRUST_PROXY handling only behind a real proxy)
.venv/bin/python -m uvicorn app:app --reload --no-proxy-headers
```

No tests or linter are configured. There is no build step (Chart.js and the web fonts are vendored under `static/`). Owner maintenance is documented in **FICHE-MAINTENANCE.md**; the in-app admin guide lives in the "Guide" tab (rendered by `renderGuide()` in `static/js/admin.js`).

## Architecture

### Data flow (living store, no build step)
`data/collection.json` is the **source of truth** — a flat list of miniature dicts. Edits (inline, CSV import, add/delete) rewrite it via `bugatti_app/store.py` with a backup + atomic write each time. Stats are **recomputed server-side** on every read (`compute_stats`), so edits reflect immediately — there is no precompiled data file. `data/site_content.json` holds the editable editorial strings (titles, subtitles, footer).

`GET /api/data` returns everything the frontend needs in one call: `{miniatures, stats, content, photos, admin}`. The old Excel→`static/data.json` pipeline is retired; the seed and `convert_data.py` are archived under `data/_seed/`.

### Backend (`app.py` + `bugatti_app/`)
- `bugatti_app/paths.py` — all filesystem paths; `data/` and `config/` are versioned, `instance/` is gitignored (secrets, analytics).
- `bugatti_app/store.py` — collection & content load/save, `compute_stats`, CSV export/import. `EDITABLE_FIELDS` and `CSV_COLUMNS` are the whitelist/format contract; CSV import validates headers exactly.
- `bugatti_app/security.py` — scrypt password (stored hashed in gitignored `instance/admin_secret.json`), stateless **HMAC-signed session cookie** (no external deps; key in gitignored `instance/session_key`), CSRF token carried in the cookie, in-memory login rate-limiting, and remote-reset (`apply_forced_reset` honors a bumped `reset_id` in versioned `data/admin_reset.json`). `rotate_session_key()` is called on password change and on forced reset to revoke all existing sessions.
- `bugatti_app/analytics.py` — appends page views to gitignored `instance/analytics.jsonl` (capped at 25 MB to bound disk use); stores an HMAC of the IP (never the raw IP) using its own `instance/analytics_salt` (independent of the session key, so rotation doesn't reset visitor counts); excludes configured IPs (`config/analytics_exclude.json`).
- `app.py` — routes, security-headers middleware (strict CSP: `default-src 'self'`), the `admin_guard` dependency that enforces session + CSRF on every write, `read_json()` (rejects oversized/malformed bodies), and the `_remove_uploaded_photo`/`_save_photos` helpers (atomic writes to gitignored `static/img/photos_index.json`).

### Frontend (`static/js/`)
- `app.js` (`window.App`) — public site: renders the collection, charts, timeline, and editorial text from `content`. It exposes `setAdminMode`, `openModal`, `openEditor`, `reload`, `toast`.
- `admin.js` (`window.Admin`) — session/login, the tabbed admin panel (Guide / Base de données / Fréquentation / Réglages), and all write calls (adds the `X-CSRF-Token` header). `app.js` calls into `window.Admin` for saves; `admin.js` calls back into `window.App` for re-render. Inline editing is a shared centered popover (`openEditor`), triggered by pencils that CSS shows only when `<body>` has `admin-mode`.

## Auth & security model (important)

- **No user accounts** — a single admin password. First admin click sets it; the "Admin" button toggles to "Site public" (logout, hides pencils, no password needed to exit). The admin session lives only in that browser's signed cookie — other visitors stay public.
- **The repo is public.** The password hash therefore must NEVER be committed — it lives only in gitignored `instance/`. To reset remotely, bump `reset_id` in `data/admin_reset.json` and push; the next launch forces re-creation. Do not add secrets to versioned files.
- **`/api/admin/setup` is loopback-only** (`is_local_request`): on a fresh public deploy with no password yet, this prevents a stranger from enrolling as admin before the owner. Override with `BUGATTI_ALLOW_REMOTE_SETUP=1` only when you understand the risk.
- **IP trust:** `client_ip()` uses only the real TCP peer (`request.client.host`); it never reads `X-Forwarded-For` itself. `bin/bugatti` launches uvicorn with `--no-proxy-headers` by default so XFF can't be spoofed to bypass the login lockout / analytics exclusion. Behind a *trusted* reverse proxy, launch with `BUGATTI_TRUST_PROXY=1`.
- When deploying over HTTPS, set `BUGATTI_HTTPS=1` so the session cookie gets the `Secure` flag.
- Owner data (collection, content, uploads, analytics) stays local and is never pushed; keep it that way so `git pull` never conflicts with the owner's edits — **do not modify `data/collection.json` in the repo after handoff.**

## Performance notes (intentional trade-offs at ~4k items)

The store favors simplicity/durability over throughput, which is fine for one local user but worth knowing before scaling: every field edit does a full backup-copy + atomic rewrite of the whole `collection.json`; `GET /api/data` re-reads the file and recomputes stats on every request (no cache). If the collection grows large or the site gets real public traffic, add an mtime-keyed in-memory cache for `load_collection()`/`compute_stats()` and coalesce writes — do not micro-optimize before then.

## Conventions

- User-facing strings are French; numbers use `toLocaleString('fr-FR')`.
- Never hand-edit `data/collection.json` for content changes — go through the app/CSV so backups and `type_number`/`echelle` normalization stay consistent.
- Miniature `id` is the join key across collection, uploads (`mini_<id>.<ext>`), and the DOM.
- `fetch_photos.py` (stdlib-only) is a dev tool to (re)download type-level car photos from Wikimedia into `static/img/types/` with an attribution `manifest.json`.

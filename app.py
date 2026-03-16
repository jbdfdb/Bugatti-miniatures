"""Les Bugatti de Pascal — FastAPI application."""
import json
import shutil
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="Les Bugatti de Pascal")

BASE = Path(__file__).parent
UPLOAD_DIR = BASE / "static" / "img" / "uploads"
TYPES_DIR = BASE / "static" / "img" / "types"
PHOTOS_INDEX = BASE / "static" / "img" / "photos_index.json"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
TYPES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")


def load_photos_index():
    if PHOTOS_INDEX.exists():
        return json.loads(PHOTOS_INDEX.read_text())
    return {}


def save_photos_index(index):
    PHOTOS_INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/photos")
async def get_photos():
    """Return all photo mappings: miniature_id -> photo URL."""
    index = load_photos_index()
    # Also include type-level photos from Wikimedia manifest
    manifest_path = TYPES_DIR / "manifest.json"
    type_photos = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for type_key, info in manifest.items():
            # Convert type_13 -> "13", type_veyron -> "veyron"
            num = type_key.replace("type_", "")
            type_photos[num] = {
                "url": f"/static/img/types/{info['filename']}",
                "attribution": info.get("author", "Wikimedia Commons"),
                "license": info.get("license", ""),
                "source": info.get("source_url", ""),
            }
    return {"miniature_photos": index, "type_photos": type_photos}


@app.post("/api/upload-photo")
async def upload_photo(
    miniature_id: int = Form(...),
    photo: UploadFile = File(...),
):
    """Upload a photo for a specific miniature."""
    ext = Path(photo.filename).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        return JSONResponse({"error": "Format non supporté. Utilisez JPG, PNG ou WebP."}, status_code=400)

    filename = f"mini_{miniature_id}{ext}"
    dest = UPLOAD_DIR / filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(photo.file, f)

    index = load_photos_index()
    index[str(miniature_id)] = {
        "url": f"/static/img/uploads/{filename}",
        "source": "upload",
    }
    save_photos_index(index)
    return {"success": True, "url": f"/static/img/uploads/{filename}"}


@app.delete("/api/photo/{miniature_id}")
async def delete_photo(miniature_id: int):
    """Remove an uploaded photo for a miniature."""
    index = load_photos_index()
    key = str(miniature_id)
    if key in index:
        filepath = BASE / index[key]["url"].lstrip("/")
        if filepath.exists():
            filepath.unlink()
        del index[key]
        save_photos_index(index)
    return {"success": True}

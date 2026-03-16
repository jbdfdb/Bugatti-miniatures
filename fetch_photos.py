#!/usr/bin/env python3
"""
Fetch freely-licensed Bugatti car photos from Wikimedia Commons.
Downloads thumbnails (~400px wide) for each Bugatti type and creates
a JSON manifest with attribution info.

Uses commons.wikimedia.org/w/thumb.php for image downloads, which is
the most reliable endpoint for programmatic thumbnail retrieval.
"""

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

API_URL = "https://commons.wikimedia.org/w/api.php"
THUMB_URL = "https://commons.wikimedia.org/w/thumb.php"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "img", "types")

# User-Agent per Wikimedia policy
USER_AGENT = "BugattiMiniaturesFetcher/1.0 (https://bugatti-miniatures.example.com/; jb@example.com) Python/urllib"

# Freely licensed categories
FREE_LICENSES = {
    "cc-by-sa-4.0", "cc-by-sa-3.0", "cc-by-sa-2.5", "cc-by-sa-2.0",
    "cc-by-4.0", "cc-by-3.0", "cc-by-2.5", "cc-by-2.0",
    "cc-by-sa-1.0", "cc-by-1.0",
    "cc0", "cc-zero", "public domain", "pd",
    "cc-pd-mark",
}

# Bugatti types: (file_key, [search_queries])
BUGATTI_TYPES = [
    ("type_13",           ["Bugatti Type 13 Brescia", "Bugatti Brescia"]),
    ("type_35",           ["Bugatti Type 35", "Bugatti 35 Grand Prix"]),
    ("type_37",           ["Bugatti Type 37"]),
    ("type_40",           ["Bugatti Type 40"]),
    ("type_41",           ["Bugatti Type 41 Royale", "Bugatti Royale"]),
    ("type_43",           ["Bugatti Type 43"]),
    ("type_46",           ["Bugatti Type 46"]),
    ("type_49",           ["Bugatti Type 49"]),
    ("type_50",           ["Bugatti Type 50"]),
    ("type_51",           ["Bugatti Type 51", "Bugatti 51 Grand Prix"]),
    ("type_55",           ["Bugatti Type 55"]),
    ("type_57",           ["Bugatti 57SC Atlantic", "Bugatti Type 57 Atalante", "Bugatti Type 57"]),
    ("type_59",           ["Bugatti Type 59"]),
    ("type_101",          ["Bugatti Type 101"]),
    ("type_110",          ["Bugatti EB110", "Bugatti EB 110"]),
    ("type_veyron",       ["Bugatti Veyron"]),
    ("type_chiron",       ["Bugatti Chiron"]),
    ("type_divo",         ["Bugatti Divo"]),
    ("type_bolide",       ["Bugatti Bolide"]),
    ("type_la_voiture_noire", ["Bugatti La Voiture Noire"]),
]


def is_free_license(license_short: str) -> bool:
    """Check if a license string matches a known free license."""
    if not license_short:
        return False
    # Normalize: lowercase, replace spaces with hyphens, strip locale suffixes
    normalized = license_short.strip().lower().replace(" ", "-")
    for free in FREE_LICENSES:
        if free in normalized:
            return True
    return False


def api_request(url: str):
    """Make a request to the Wikimedia API."""
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
        print(f"  API error: {e}")
        return None


def search_commons(query: str, limit: int = 10):
    """Search Wikimedia Commons for images matching query."""
    params = {
        "action": "query",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": str(limit),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": "400",
        "format": "json",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return api_request(url)


def pick_best_image(data: dict):
    """
    From API results, pick the best freely-licensed photograph.
    Returns (filename_on_commons, attribution_dict) or (None, None).
    """
    if not data or "query" not in data or "pages" not in data["query"]:
        return None, None

    pages = data["query"]["pages"]
    candidates = []

    for page_id, page in pages.items():
        imageinfo_list = page.get("imageinfo", [])
        if not imageinfo_list:
            continue
        ii = imageinfo_list[0]

        # Only consider raster images (JPEG/PNG)
        mime = ii.get("mime", "")
        if mime not in ("image/jpeg", "image/png"):
            continue

        meta = ii.get("extmetadata", {})
        license_short = meta.get("LicenseShortName", {}).get("value", "")

        if not is_free_license(license_short):
            continue

        width = ii.get("width", 0)

        author_raw = meta.get("Artist", {}).get("value", "Unknown")
        author = re.sub(r"<[^>]+>", "", author_raw).strip() or "Unknown"
        # Truncate overly verbose author fields (some include full license text)
        if len(author) > 100:
            # Take only the first line/sentence
            first_line = author.split("\n")[0].strip()
            if len(first_line) > 100:
                first_line = first_line[:100].rsplit(" ", 1)[0]
            author = first_line

        source_url = ii.get("descriptionurl", "")
        title = page.get("title", "")

        candidates.append({
            "author": author,
            "license": license_short,
            "source_url": source_url,
            "width": width,
            "title": title,
            "mime": mime,
        })

    if not candidates:
        return None, None

    # Sort by original width descending — prefer higher-res originals
    candidates.sort(key=lambda c: c["width"], reverse=True)
    best = candidates[0]

    # Extract the raw filename from the title (strip "File:" prefix)
    commons_filename = best["title"]
    if commons_filename.startswith("File:"):
        commons_filename = commons_filename[5:]

    attribution = {
        "author": best["author"],
        "license": best["license"],
        "source_url": best["source_url"],
        "title": best["title"],
        "mime": best["mime"],
    }
    return commons_filename, attribution


def download_thumb(commons_filename: str, width: int, dest_path: str) -> bool:
    """
    Download a thumbnail using commons.wikimedia.org/w/thumb.php.
    This endpoint serves thumbnails directly from the commons server
    without going through upload.wikimedia.org CDN.
    """
    params = {
        "f": commons_filename,
        "w": str(width),
    }
    url = THUMB_URL + "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "image/jpeg, image/png, image/*;q=0.9, */*;q=0.5",
    })

    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read()

            if len(data) < 500:
                print(f"  Warning: thumbnail very small ({len(data)} bytes)")
                return False

            # Verify we got an image, not an error page
            if "text/html" in content_type:
                print(f"  Warning: got HTML instead of image")
                return False

            with open(dest_path, "wb") as f:
                f.write(data)
            return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Download error: {e}")
        return False


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    manifest = {}

    for file_key, queries in BUGATTI_TYPES:
        print(f"\n--- {file_key} ---")
        found = False

        for query in queries:
            print(f"  Searching: {query}")
            data = search_commons(query)
            commons_filename, attribution = pick_best_image(data)

            if commons_filename and attribution:
                # Determine output extension
                ext = ".jpg"
                if attribution.get("mime") == "image/png":
                    ext = ".png"
                out_filename = file_key + ext
                dest = os.path.join(OUTPUT_DIR, out_filename)

                print(f"  Found: {attribution['title']}")
                print(f"  License: {attribution['license']} | Author: {attribution['author'][:60]}")

                if download_thumb(commons_filename, 400, dest):
                    file_size = os.path.getsize(dest)
                    print(f"  Saved: {out_filename} ({file_size:,} bytes)")
                    manifest[file_key] = {
                        "filename": out_filename,
                        "author": attribution["author"],
                        "license": attribution["license"],
                        "source_url": attribution["source_url"],
                        "wikimedia_title": attribution["title"],
                    }
                    found = True
                    break
                else:
                    print(f"  Download failed, trying next query...")
            else:
                print(f"  No suitable free image found for '{query}'")

            time.sleep(1)

        if not found:
            print(f"  SKIPPED: No freely-licensed photo found for {file_key}")

        time.sleep(1)

    # Write manifest
    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"Done! Downloaded {len(manifest)}/{len(BUGATTI_TYPES)} images.")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()

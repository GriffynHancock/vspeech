#!/usr/bin/env python3
"""
build_wiki_index.py
────────────────────────────────────────────────────────────────────
Downloads all Wikipedia Vital Articles Level 4 (~10,000 pages) and
records their current stable revision IDs. Output is a JSON index
compatible with vectorspeech_engine_fixed.py.

Features:
  - Full pagination through the Wikipedia category API
  - Batch revision-ID lookup (50 titles per API call)
  - Resume from partial progress (--resume)
  - Progress written to stdout as JSON lines (for the server to stream)
  - Checksum of the final index for integrity verification

Usage:
  python3 build_wiki_index.py                      # full build
  python3 build_wiki_index.py --resume             # continue interrupted build
  python3 build_wiki_index.py --level 3            # build Level 3 (~1,000 pages)
  python3 build_wiki_index.py --out myindex.json   # custom output path
  python3 build_wiki_index.py --progress-json      # machine-readable progress (for server)
"""

import argparse
import hashlib
import json
import os
import sys
import time
import ssl
from pathlib import Path
import urllib.request
import urllib.parse
import urllib.error
from typing import Iterator

# Handle SSL certificate verification issues (common on macOS)
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

WIKIPEDIA_API   = "https://en.wikipedia.org/w/api.php"
USER_AGENT      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Vital Articles category names by level
LEVEL_CATEGORIES = {
    1: "Wikipedia:Vital articles",
    2: "Wikipedia:Vital articles/Level 2",
    3: "Wikipedia:Vital articles/Level 3",
    4: "Wikipedia:Vital articles/Level 4",
    5: "Wikipedia:Vital articles/Level 5",
}

# Expected approximate counts per level (for ETA calculation)
LEVEL_EXPECTED = {1: 10, 2: 100, 3: 1_000, 4: 10_000, 5: 50_000}

BATCH_SIZE       = 50    # titles per revision-ID lookup
CATEGORY_LIMIT   = 500   # max per category API call
POLITE_DELAY     = 0.05  # seconds between API calls (be nice to WP)


# ─────────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────────

def emit(msg: dict, as_json: bool) -> None:
    """Write progress. JSON mode: one JSON object per line. Human mode: text."""
    if as_json:
        print(json.dumps(msg), flush=True)
    else:
        kind = msg.get("type", "info")
        text = msg.get("message", "")
        if kind == "progress":
            done = msg.get("done", 0)
            total = msg.get("total", 0)
            pct = int(done / total * 100) if total else 0
            bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
            print(f"\r  [{bar}] {pct:3d}%  {done:,}/{total:,}  {text}   ", end="", flush=True)
        elif kind == "error":
            print(f"\n  ✗ {text}", flush=True)
        elif kind == "done":
            print(f"\n  ✓ {text}", flush=True)
        else:
            print(f"  {text}", flush=True)


# ─────────────────────────────────────────────────────────────────
# Wikipedia API helpers
# ─────────────────────────────────────────────────────────────────

def api_get(params: dict, retries: int = 5) -> dict:
    params["format"] = "json"
    url = WIKIPEDIA_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise RuntimeError(f"API call failed after {retries} attempts: {e}") from e
    return {}


def iter_category_members(page_title: str) -> Iterator[str]:
    """Yield all article titles in a Wikipedia category page (using its wikilinks)."""
    # Strategy: parse the vital articles list page directly — more reliable than
    # the category API which misses subcategories. We fetch the page wikitext,
    # extract all internal links that look like article titles (not Talk: etc.).
    params = {
        "action":   "query",
        "prop":     "revisions",
        "titles":   page_title,
        "rvprop":   "content",
        "rvslots":  "main",
        "rvlimit":  "1",
    }
    data    = api_get(params)
    pages   = data.get("query", {}).get("pages", {})
    content = ""
    for p in pages.values():
        revs = p.get("revisions", [])
        if revs:
            content = revs[0].get("slots", {}).get("main", {}).get("*", "")

    if not content:
        # Fallback to category API
        yield from iter_category_api(page_title)
        return

    # Extract [[Article title]] links, skipping non-article namespaces
    import re
    seen: set[str] = set()
    skip_prefixes  = (
        "Wikipedia:", "WP:", "Talk:", "User:", "File:", "Image:",
        "Template:", "Help:", "Portal:", "Category:", "Special:",
        "#", ":",
    )
    for m in re.finditer(r"\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]", content):
        title = m.group(1).strip()
        if not title or title in seen:
            continue
        if any(title.startswith(p) for p in skip_prefixes):
            continue
        seen.add(title)
        yield title


def iter_category_api(category_title: str) -> Iterator[str]:
    """Yield article titles from a Wikipedia category via the API (paginated)."""
    cont: dict = {}
    while True:
        params: dict = {
            "action":      "query",
            "list":        "categorymembers",
            "cmtitle":     f"Category:{category_title}",
            "cmtype":      "page",
            "cmlimit":     str(CATEGORY_LIMIT),
            "cmprop":      "title",
            **cont,
        }
        data    = api_get(params)
        members = data.get("query", {}).get("categorymembers", [])
        for m in members:
            yield m["title"]
        if "continue" in data:
            cont = data["continue"]
            time.sleep(POLITE_DELAY)
        else:
            break


def fetch_revision_ids(titles: list[str]) -> dict[str, int]:
    """Return {title: latest_revid} for up to 50 titles at once."""
    params = {
        "action":  "query",
        "titles":  "|".join(titles),
        "prop":    "revisions",
        "rvprop":  "ids",
    }
    data   = api_get(params)
    pages  = data.get("query", {}).get("pages", {})
    result: dict[str, int] = {}
    for page in pages.values():
        title = page.get("title", "")
        revs  = page.get("revisions", [])
        if revs and title:
            result[title] = revs[0].get("revid", 0)
    return result


# ─────────────────────────────────────────────────────────────────
# Main build function
# ─────────────────────────────────────────────────────────────────

def build_index(level: int, out_path: Path, resume: bool, as_json: bool) -> None:
    page_title = LEVEL_CATEGORIES[level]
    expected   = LEVEL_EXPECTED.get(level, 1000)

    emit({"type": "info", "message": f"Building Level {level} index (~{expected:,} articles expected)"}, as_json)
    emit({"type": "info", "message": f"Output: {out_path}"}, as_json)

    # ── Load existing partial progress ──
    existing: dict[str, int] = {}   # title → revid
    if resume and out_path.exists():
        try:
            with open(out_path) as f:
                saved = json.load(f)
            existing = {e["title"]: e["revid"] for e in saved.get("index", [])}
            emit({"type": "info", "message": f"Resuming: {len(existing):,} articles already have revision IDs"}, as_json)
        except Exception as e:
            emit({"type": "info", "message": f"Could not load existing file ({e}), starting fresh"}, as_json)

    # ── Phase 1: collect all titles ──
    emit({"type": "phase", "phase": 1, "message": "Fetching article titles from Wikipedia…"}, as_json)
    all_titles: list[str] = []
    start_t = time.time()

    titles_cache = out_path.with_suffix(".titles_cache.json")
    if resume and titles_cache.exists():
        emit({"type": "info", "message": "Using cached title list"}, as_json)
        with open(titles_cache) as f:
            all_titles = json.load(f)
    else:
        emit({"type": "info", "message": f"Fetching category members for '{page_title}'…"}, as_json)
        try:
            for title in iter_category_members(page_title):
                all_titles.append(title)
                if len(all_titles) % 500 == 0:
                    emit({"type": "progress", "phase": 1, "done": len(all_titles),
                          "total": expected, "message": "fetching titles…"}, as_json)
                    time.sleep(POLITE_DELAY)
        except Exception as e:
            emit({"type": "error", "message": f"Title fetch failed: {e}"}, as_json)
            sys.exit(1)

        # Save title cache for resume
        with open(titles_cache, "w") as f:
            json.dump(all_titles, f)

    total = len(all_titles)
    emit({"type": "info", "message": f"Found {total:,} article titles"}, as_json)
    if total == 0:
        emit({"type": "error", "message": "No articles found — check your internet connection"}, as_json)
        sys.exit(1)

    # ── Phase 2: fetch revision IDs in batches ──
    emit({"type": "phase", "phase": 2, "message": "Fetching revision IDs…"}, as_json)

    index: dict[str, int] = dict(existing)  # carry over resumed entries
    to_fetch = [t for t in all_titles if t not in index]
    batches  = [to_fetch[i:i + BATCH_SIZE] for i in range(0, len(to_fetch), BATCH_SIZE)]
    done_count = len(existing)
    errors     = 0

    for batch_num, batch in enumerate(batches):
        try:
            revids = fetch_revision_ids(batch)
            index.update(revids)
            done_count += len(revids)
            if len(revids) < len(batch):
                errors += len(batch) - len(revids)
        except Exception as e:
            errors += len(batch)
            emit({"type": "warning", "message": f"Batch {batch_num} failed: {e}"}, as_json)

        if batch_num % 10 == 0 or batch_num == len(batches) - 1:
            elapsed = time.time() - start_t
            eta     = int((total - done_count) / max(done_count, 1) * elapsed) if done_count else 0
            emit({
                "type": "progress", "phase": 2,
                "done": done_count, "total": total,
                "message": f"eta {eta}s  errors {errors}",
                "percent": int(done_count / total * 100),
            }, as_json)

            # Save partial progress every 10 batches
            _save_index(out_path, index, level, total, partial=True)

        time.sleep(POLITE_DELAY)

    # ── Phase 3: write final index ──
    emit({"type": "phase", "phase": 3, "message": "Writing final index…"}, as_json)
    checksum = _save_index(out_path, index, level, total, partial=False)

    # Clean up title cache
    if titles_cache.exists():
        titles_cache.unlink()

    n = len(index)
    emit({
        "type":     "done",
        "message":  f"Index complete: {n:,} articles, {errors} errors",
        "articles": n,
        "errors":   errors,
        "checksum": checksum,
        "path":     str(out_path),
    }, as_json)


def _save_index(
    out_path: Path,
    index: dict[str, int],
    level: int,
    total: int,
    partial: bool,
) -> str:
    entries = [{"title": t, "revid": r} for t, r in sorted(index.items())]
    blob    = json.dumps(entries, separators=(",", ":")).encode()
    chk     = hashlib.sha256(blob).hexdigest()

    data = {
        "metadata": {
            "version":       level,
            "snapshot_date": time.strftime("%Y-%m-%d"),
            "total_articles": total,
            "indexed":        len(entries),
            "partial":        partial,
            "checksum":       chk,
            "built_by":       "build_wiki_index.py",
        },
        "index": entries,
    }
    # Write atomically via a temp file
    tmp = out_path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(out_path)
    return chk


# ─────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a Wikipedia Vital Articles index for VectorSpeech",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full Level 4 build (~10,000 articles, ~5-15 min):
  python3 build_wiki_index.py

  # Resume an interrupted build:
  python3 build_wiki_index.py --resume

  # Faster but smaller Level 3 (~1,000 articles):
  python3 build_wiki_index.py --level 3

  # Machine-readable output (for the VectorSpeech server):
  python3 build_wiki_index.py --progress-json
        """,
    )
    parser.add_argument("--level",         type=int, default=4, choices=[2, 3, 4, 5],
                        help="Vital articles level (default: 4 = ~10,000 articles)")
    parser.add_argument("--out",           type=str, default="",
                        help="Output JSON path (default: vital_articles_v{level}.json)")
    parser.add_argument("--resume",        action="store_true",
                        help="Resume a partial build")
    parser.add_argument("--progress-json", action="store_true",
                        help="Emit machine-readable JSON progress lines (for server integration)")
    args = parser.parse_args()

    out_path = Path(args.out or f"vital_articles_v{args.level}.json")

    if args.level not in LEVEL_CATEGORIES:
        print(f"ERROR: Level {args.level} not supported. Choose from {list(LEVEL_CATEGORIES.keys())}")
        sys.exit(1)

    build_index(args.level, out_path, args.resume, args.progress_json)


if __name__ == "__main__":
    main()

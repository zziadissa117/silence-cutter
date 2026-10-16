"""Uploads from the phone in pieces, so a dropped connection costs one piece.

start() says how many pieces of PART_BYTES are expected; each piece is written
at its place in a hidden file; finish() checks every piece is there and the
file is the size promised, then the file is checked with ffprobe and moved into
place (a clip into its series, a song into the shared library). Nothing half
uploaded is ever seen by a render.
"""

import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import config
from .plateau_paths import DATA

UPLOADS = DATA / "uploads"
STALE_SEC = 2 * 86400
_lock = threading.Lock()


def _meta_path(upload_id: str) -> Path:
    return UPLOADS / f"{upload_id}.json"


def _data_path(upload_id: str) -> Path:
    return UPLOADS / f"{upload_id}.part"


def _valid_id(upload_id: str) -> bool:
    return len(upload_id) == 32 and all(c in "0123456789abcdef" for c in upload_id)


def start(kind: str, campaign: str, name: str, size: int, space: str) -> dict:
    if kind not in ("hook", "product", "song"):
        raise ValueError("Which kind of file?")
    if not isinstance(size, int) or size <= 0 or size > config.MAX_UPLOAD_BYTES:
        raise ValueError("That file is too big to send.")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    upload_id = uuid.uuid4().hex
    parts = (size + config.PART_BYTES - 1) // config.PART_BYTES
    meta = {"kind": kind, "campaign": campaign, "name": str(name)[:200], "size": size, "parts": parts,
            "have": [], "space": space, "at": time.time()}
    _meta_path(upload_id).write_text(json.dumps(meta))
    with open(_data_path(upload_id), "wb") as f:
        f.truncate(size)
    return {"id": upload_id, "parts": parts, "partBytes": config.PART_BYTES}


def meta(upload_id: str, space: str) -> dict | None:
    if not _valid_id(upload_id):
        return None
    try:
        m = json.loads(_meta_path(upload_id).read_text())
    except (OSError, ValueError):
        return None
    return m if m.get("space") == space else None


def put(upload_id: str, part: int, body: bytes, space: str) -> dict:
    with _lock:
        m = meta(upload_id, space)
        if not m:
            raise LookupError("That upload is gone - start it again.")
        if not (0 <= part < m["parts"]):
            raise ValueError("No such piece.")
        expected = min(config.PART_BYTES, m["size"] - part * config.PART_BYTES)
        if len(body) != expected:
            raise ValueError("That piece is the wrong size.")
        with open(_data_path(upload_id), "r+b") as f:
            f.seek(part * config.PART_BYTES)
            f.write(body)
        if part not in m["have"]:
            m["have"].append(part)
        _meta_path(upload_id).write_text(json.dumps(m))
        return {"missing": [p for p in range(m["parts"]) if p not in m["have"]]}


def probe(path: Path, want: str) -> bool:
    """Whether the file has a picture (want="video") or a sound (want="audio")."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    return r.returncode == 0 and want in r.stdout.split()


def finish(upload_id: str, space: str) -> tuple[dict, Path]:
    """The upload's details and its complete file, once every piece is in."""
    m = meta(upload_id, space)
    if not m:
        raise LookupError("That upload is gone - start it again.")
    missing = [p for p in range(m["parts"]) if p not in m["have"]]
    if missing:
        raise ValueError(f"{len(missing)} piece(s) still missing.")
    path = _data_path(upload_id)
    if path.stat().st_size != m["size"]:
        raise ValueError("The file isn't the size it should be.")
    return m, path


def forget(upload_id: str) -> None:
    for p in (_meta_path(upload_id), _data_path(upload_id)):
        p.unlink(missing_ok=True)


def sweep(now: float | None = None) -> None:
    """Uploads started days ago and never finished go."""
    now = now or time.time()
    if not UPLOADS.is_dir():
        return
    for m in UPLOADS.glob("*.json"):
        try:
            started = json.loads(m.read_text()).get("at", 0)
        except (OSError, ValueError):
            started = 0
        if now - started > STALE_SEC:
            forget(m.stem)
    for p in UPLOADS.glob("*.part"):
        if not _meta_path(p.stem).exists():
            os.remove(p)

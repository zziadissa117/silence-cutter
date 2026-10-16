"""Near-copies never go out (Le plateau's guard, from autopilote.py).

Each video's fingerprint is two frames a second, each shrunk to 9x8 grey and
turned into a 64-bit difference hash. A new video is compared with what went
out before: the share of its frames with a twin (10 bits or fewer apart)
anywhere in the other. Ilyan's thresholds, measured on his footage: refused
at 70% against the same campaign in the last 30 days (a hook re-cut at the
same spot), at 35% against any other campaign in 90 days (another account's
clips), and against the videos already accepted in the same batch.
"""

import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

from .plateau_paths import DATA

HISTORY = DATA / "guard" / "history.json"
SAME_SEC = 30 * 86400
OTHER_SEC = 90 * 86400
SAME_LIMIT = 0.70
OTHER_LIMIT = 0.35
TWIN_BITS = 10

_lock = threading.Lock()


def dhash(pixels: bytes) -> int:
    """One 9x8 grey frame (72 bytes, rows of 9) as 64 bits: each pixel brighter than its right neighbour."""
    bits = 0
    for r in range(8):
        row = pixels[r * 9:(r + 1) * 9]
        for c in range(8):
            bits = (bits << 1) | (1 if row[c] > row[c + 1] else 0)
    return bits


def fingerprint(video: Path) -> list[int]:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "fps=2,scale=9:8:flags=area,format=gray",
         "-f", "rawvideo", "-"],
        capture_output=True, timeout=600,
    )
    if out.returncode != 0:
        raise RuntimeError(f"fingerprint failed: {out.stderr.decode(errors='replace')[-200:]}")
    raw = out.stdout
    return [dhash(raw[i:i + 72]) for i in range(0, len(raw) - 71, 72)]


def similarity(new: list[int], old: list[int]) -> float:
    """The share of `new`'s frames that have a twin anywhere in `old`."""
    if not new or not old:
        return 0.0
    twins = sum(1 for a in new if any(bin(a ^ b).count("1") <= TWIN_BITS for b in old))
    return twins / len(new)


def _load() -> list[dict]:
    try:
        return json.loads(HISTORY.read_text())
    except (OSError, ValueError):
        return []


def verdict(new: list[int], series: str, batch: list[list[int]], now: float | None = None) -> tuple[bool, float, str]:
    """Whether a new video may go: (ok, the worst share found, against what)."""
    now = now or time.time()
    worst, what = 0.0, ""
    for prints in batch:
        s = similarity(new, prints)
        if s > worst:
            worst, what = s, "this batch"
        if s >= SAME_LIMIT:
            return False, s, "this batch"
    for entry in _load():
        age = now - entry.get("at", 0)
        same = entry.get("series") == series
        if (same and age > SAME_SEC) or (not same and age > OTHER_SEC):
            continue
        s = similarity(new, [int(h, 16) for h in entry.get("hashes", [])])
        if s > worst:
            worst, what = s, "this campaign" if same else "another campaign"
        if s >= (SAME_LIMIT if same else OTHER_LIMIT):
            return False, s, what
    return True, worst, what


def remember(new: list[int], series: str, key: str, now: float | None = None) -> None:
    """Keeps a video that went out, for the next ones to be compared with."""
    now = now or time.time()
    with _lock:
        kept = [e for e in _load() if now - e.get("at", 0) <= OTHER_SEC]
        kept.append({"series": series, "key": key, "at": now, "hashes": [format(h, "016x") for h in new]})
        HISTORY.parent.mkdir(parents=True, exist_ok=True)
        tmp = HISTORY.parent / f".history-{uuid.uuid4().hex}.json"
        tmp.write_text(json.dumps(kept))
        os.replace(tmp, HISTORY)

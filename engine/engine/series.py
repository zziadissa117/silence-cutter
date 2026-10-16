"""One series per campaign: its footage and how its videos are put together.

A series is Le plateau's own folder (remixer.py): serie.json, slots/hook and
slots/product with the clips, output/ for what is made. The phone sets the few
things that matter - his hook lines, how long each part is, which corner the
text goes - and this writes the rest the way Ilyan's account preset does:
1080x1920 at 30 fps, at most 20 Mb/s, the song from the shared library
starting on its chorus, and one light change per clip (speed, a slight crop,
sharpening or a tiny colour shift) so no two videos are the same file.
"""

import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path

from .plateau_paths import SERIES

KINDS = ("hook", "product")
VIDEO_EXTS = (".mp4", ".mov", ".m4v")

_lock = threading.Lock()


def safe_id(value: str) -> str:
    """A campaign id as a folder name: letters, digits, - and _ only."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", value or "")[:64]
    if not cleaned:
        raise ValueError("Which campaign?")
    return cleaned


def folder(campaign_id: str) -> Path:
    return SERIES / safe_id(campaign_id)


DEFAULTS = {
    "name": "",
    # The words over the hook: his own lines (Claude's rewordings are added
    # at make time, see hooks.py).
    "hooks": [],
    "hookSec": [3.0, 4.0],
    "productSec": [5.0, 7.0],
    # One light change per clip. Off: clips go in as they are, cut points only.
    "variation": True,
    # Where the hook's words go: haut (top), milieu, bas.
    "textPos": "haut",
}


def settings_of(campaign_id: str) -> dict:
    path = folder(campaign_id) / "engine.json"
    try:
        saved = json.loads(path.read_text())
    except (OSError, ValueError):
        saved = {}
    return {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}


def clean_settings(data: dict) -> dict:
    """What the phone may set, checked."""
    out = {}
    if isinstance(data.get("name"), str):
        out["name"] = data["name"][:200]
    if isinstance(data.get("hooks"), list):
        hooks = [h.strip()[:200] for h in data["hooks"] if isinstance(h, str) and h.strip()]
        out["hooks"] = list(dict.fromkeys(hooks))[:300]
    for key, lo, hi in (("hookSec", 1.0, 15.0), ("productSec", 1.0, 30.0)):
        pair = data.get(key)
        if isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, (int, float)) for x in pair):
            a, b = sorted(min(hi, max(lo, float(x))) for x in pair)
            out[key] = [a, b]
    if isinstance(data.get("variation"), bool):
        out["variation"] = data["variation"]
    if data.get("textPos") in ("haut", "milieu", "bas"):
        out["textPos"] = data["textPos"]
    return out


def save_settings(campaign_id: str, data: dict) -> dict:
    d = folder(campaign_id)
    with _lock:
        d.mkdir(parents=True, exist_ok=True)
        merged = {**settings_of(campaign_id), **clean_settings(data)}
        tmp = d / f".engine-{uuid.uuid4().hex}.json"
        tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
        os.replace(tmp, d / "engine.json")
    return merged


def serie_for(campaign_id: str, hook_lines: list[str] | None = None) -> dict:
    """Le plateau's serie.json for this campaign, as remixer.generate reads it."""
    s = settings_of(campaign_id)
    lines = hook_lines if hook_lines is not None else s["hooks"]
    light = {
        "speed_min": 1.0, "speed_max": 1.04,
        "zoom_min": 0.0, "zoom_max": 0.015,
        "brightness_amp": 0.02, "contrast_amp": 0.02, "saturation_amp": 0.03, "hue_amp": 2.0,
        "sharpen_min": 1.0, "sharpen_max": 2.0, "one_effect": 1,
    } if s["variation"] else {
        "speed_min": 1.0, "speed_max": 1.0, "zoom_min": 0.0, "zoom_max": 0.0,
        "brightness_amp": 0.0, "contrast_amp": 0.0, "saturation_amp": 0.0, "hue_amp": 0.0,
        "sharpen_min": 0.0, "sharpen_max": 0.0, "one_effect": 1,
    }
    return {
        "id": safe_id(campaign_id),
        "name": s["name"] or safe_id(campaign_id),
        "slots": [
            {"id": "hook", "name": "Hook", "min": 1, "max": 1,
             "dur_min": s["hookSec"][0], "dur_max": s["hookSec"][1],
             "text_pos": s["textPos"], "allow_zoom": False, "captions": lines},
            {"id": "product", "name": "Product", "min": 1, "max": 1,
             "dur_min": s["productSec"][0], "dur_max": s["productSec"][1],
             "remplir": True, "captions": []},
        ],
        "settings": {"fps": 30, "crf": 18, "mute": 0, "music_library": 1, "caption_prob": 1.0, **light},
        "captions": [],
    }


def files(campaign_id: str) -> dict:
    """The clips kept for a campaign, by kind: name, size."""
    d = folder(campaign_id)
    out = {}
    for kind in KINDS:
        slot = d / "slots" / kind
        out[kind] = sorted(
            ({"name": p.name, "size": p.stat().st_size} for p in slot.iterdir()
             if p.is_file() and p.suffix.lower() in VIDEO_EXTS and not p.name.startswith(".")),
            key=lambda f: f["name"],
        ) if slot.is_dir() else []
    return out


def keep_clip(campaign_id: str, kind: str, tmp: Path, name: str) -> str:
    """Moves an uploaded clip into its place, under a name of its own. Returns the name."""
    if kind not in KINDS:
        raise ValueError("Which kind of clip?")
    slot = folder(campaign_id) / "slots" / kind
    slot.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\-. ()]+", "_", Path(name).stem).strip(" ._")[:60] or "clip"
    ext = Path(name).suffix.lower() if Path(name).suffix.lower() in VIDEO_EXTS else ".mp4"
    with _lock:
        final = slot / f"{stem}{ext}"
        n = 2
        while final.exists():
            final = slot / f"{stem} ({n}){ext}"
            n += 1
        os.replace(tmp, final)
    return final.name


def remove_clip(campaign_id: str, kind: str, name: str) -> bool:
    if kind not in KINDS or "/" in name or "\\" in name or name.startswith("."):
        return False
    path = folder(campaign_id) / "slots" / kind / name
    if path.is_file():
        path.unlink()
        return True
    return False


def output_dir(campaign_id: str) -> Path:
    return folder(campaign_id) / "output"


def clear_output(campaign_id: str) -> None:
    shutil.rmtree(output_dir(campaign_id), ignore_errors=True)

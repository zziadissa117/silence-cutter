"""Points Le plateau's files (engine/plateau) at the engine's data folder.

They were written for a folder on Ilyan's PC and keep their data next to
themselves; here everything lives under DATA (a Railway volume), so the
container can be replaced without losing footage, songs or what was posted.
Import this before any of them.
"""

import os
import sys
from pathlib import Path

DATA = Path(os.environ.get("ENGINE_DATA", "/data")).resolve()
PLATEAU = Path(__file__).resolve().parent.parent / "plateau"

if str(PLATEAU) not in sys.path:
    sys.path.insert(0, str(PLATEAU))

import remixer  # noqa: E402
import sons  # noqa: E402

SERIES = DATA / "series"
SOUNDS = DATA / "sounds"

sons.ROOT = DATA
sons.DIR = SOUNDS
sons.LIB = SOUNDS / "library.json"
sons.VERROU = SOUNDS / ".library.lock"
sons.SERIES_DIR = SERIES
remixer._PROBE_FILE = DATA / ".probe-cache.json"

for folder in (SERIES, SOUNDS):
    folder.mkdir(parents=True, exist_ok=True)

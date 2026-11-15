# The Cutter Guide

- `cutter-guide.pdf` - the guide for students and everyone using the Cutter (A4).
- `cutter-guide.html` - its source. Edit this, then build the PDF again.
- `shots/` - its screenshots, named by section (`05-batch-07-clip-screen.png`), 390×844 at 2×, and
  `shots/marks.json`: where the things to tap are on each one, for the numbered markers.
- `INVENTORY.md` - every feature with where it lives in the code, ranked for UGC work, and what was tested.

Every name, account, number and video in the screenshots is made up: they are taken in **demo mode**
(`src/demo/`, `npm run dev` then `campaign.html?demo=1`), which only exists on a computer's dev server and
never reaches the real server.

## Making it again

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

```bash
CHROME=/path/to/chrome-for-testing FAKE_MEDIA=/folder/with/cam.y4m+mic2.wav node docs/guide/tools/shots.cjs
```

```bash
node docs/guide/tools/build_pdf.cjs
```

- `CHROME`: a Chrome that plays and makes H.264 (Chrome for Testing 138, see `CLAUDE.md`). Plain Chromium works
  but shows no video frames.
- `FAKE_MEDIA` (optional): a fake camera (`cam.y4m`) and microphone (`mic2.wav`: 5 s of quiet, then speech) for
  the Record and Your voice shots. Without it those shots are skipped.
- `shots.cjs groups…` takes only some groups: `start cutting campaigns posting batch formats analytics trial motion
  settings hooks ancamp`. It reports any real name from the app's own hints, anything wider than the phone, and
  any marker it could not find on the screen (with `DOM_DIR=/folder` it saves that page there, to fix the
  selector in `MARKS`).
- `build_pdf.cjs` needs Playwright and python3 with `pypdf` and Pillow; it writes the contents' page numbers
  itself and draws the numbered markers. A figure's `data-shot` names its screenshot and `data-start` its first
  number; the build stops when a step's number has no marker or a marker no step (`DRAFT=1` builds anyway).
- The guide shows how to use the app, task by task. Keep it that way: what to tap and what you get, not how
  the app works inside.
- The demo's footage (a drawn creator, a robot voice, made-up songs and logos): `tools/make_demo_media.py`
  (Pillow, ffmpeg, espeak-ng).

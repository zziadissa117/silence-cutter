# The engine

Ilyan's Le plateau running on a server (Railway), so a big batch is made with the phone closed.

The phone (Batch tab, layout **On the engine**) sends it the campaign's hook takes, product clips, hook lines and
songs once. For each video of the batch, the engine:

1. makes it with Le plateau's `remixer` (a hook cut out of a take, the product clips, his text, a song from its
   chorus, a little colour / zoom / speed variation each time);
2. checks it isn't a near-copy of anything sent in the last 30 days (90 for other campaigns) or of the batch so far
   (`guard.py`, a picture fingerprint every half second), making it again up to three times if it is;
3. sends it through the Cutter's posting function, exactly as the phone does, with its batch day and time - so it
   waits in Posts like any batch: watch one, then **Approve all**;
4. deletes its own copy (Postiz has it).

Claude rewords the hook lines a little for each video when `ANTHROPIC_API_KEY` is set (`hooks.py`); without it his
lines are used as written.

Every call needs the phone's Cutter login, checked with the `cutter` function's `whoami`. Only the app's page may
call it from a browser.

## Setting it up on Railway (once)

1. **New project** -> Deploy from GitHub repo -> `zziadissa117/silence-cutter`.
2. In the service's **Settings**:
   - **Source**: branch `claude/cutter-lockdown-and-map`, **Root Directory** `engine`.
   - **Config file path** (Config-as-code): `/engine/railway.json` - gives Railway the health check and restarts.
   - **Networking**: **Generate Domain**. That address is what goes in the Cutter.
3. **Add a volume** to the service, mounted at **`/data`**. Footage, songs and what was already sent live there;
   without it everything is lost on each deploy.
4. **Variables** (all optional):
   - `ANTHROPIC_API_KEY` - for the reworded hooks.
   - `ALLOWED_ORIGIN` - only if the app moves from `https://silence-cutter.netlify.app`.
5. On the Mac: `./deploy-server.sh` (the login function needs `whoami`), then `./deploy.sh`.
6. On the phone: Settings, **Engine**, paste the address, **Connect**. It says how much space is free and whether
   Claude is on.

Each push to the branch redeploys the engine. A batch being made when that happens stops; **Carry on** in Batch makes
the rest (each video has its own key, so nothing is posted twice).

## Running it here

```
cd engine
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # needs ffmpeg installed
ENGINE_DATA=/tmp/engine-data .venv/bin/python -m engine.server
.venv/bin/python -m unittest tests.test_engine                       # real renders, a few seconds each
```

## What's where

| File | What |
|---|---|
| `engine/server.py` | the web routes (list at its top) |
| `engine/jobs.py` | batches, one at a time, in the background; Carry on (`again`) |
| `engine/series.py` | a campaign's clips and settings, turned into Le plateau's `serie` |
| `engine/uploads.py` | footage arriving in 8 MB pieces |
| `engine/guard.py` | the near-copy check |
| `engine/hooks.py` | Claude rewording the hook lines |
| `engine/poster.py` | sending a finished video like the phone does |
| `engine/auth.py` | checking the phone's login |
| `engine/plateau_paths.py` | points Le plateau's folders at `/data` |
| `plateau/` | Ilyan's files, unchanged (see its README) |

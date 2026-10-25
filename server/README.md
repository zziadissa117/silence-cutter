# The Cutter server

The Cutter itself, running on a server (Railway), so the batches are made day and night with the phone closed. It
is the same app - the same mixing, the same rendering, the same sending - opened in Chrome on the server instead
of Safari on the phone, so the videos are the ones the phone would make. Only the phone is left out of it.

Once its address is in the Cutter (Settings, **Server**), every batch is made there by itself: the phone sends up
each clip once and every change he makes in the Batch tab, and shows what the server has made. Videos wait in
Posts for approval as always.

## Setting it up on Railway (once)

1. **New project** -> **Deploy from GitHub repo** -> `zziadissa117/silence-cutter`.
2. In the new service's **Settings**:
   - **Source**: branch `claude/cutter-lockdown-and-map` (not `main`). Leave **Root Directory** empty (the whole repo).
   - Nothing to set for the build: Railway finds the `Dockerfile` at the top of the repo and builds it.
     (Railway's config files - "Config-as-code" - can't be turned on for new services since 2026-08-28.
     A service that already has `/server/railway.json` as its config file keeps it until 2026-12-01: it
     points at the same `Dockerfile`, so both ways build the same server. Its "deprecated" notice is only that.)
   - **Networking** -> **Generate Domain**, port **8080**. That address is what goes in the Cutter. The server
     answers on 8080 whatever `PORT` Railway gives it.
   - Optional, under **Deploy**: Healthcheck Path `/health`, Restart Policy **Always**.

   **How to tell it worked:** `https://<the address>/health` shows one line of text, `{"ok":true,"version":"..."}`.
   If it shows the Cutter app (its sign-in), Railway built the repo as a plain website: the branch is wrong
   (the old `main` has no server), or the build didn't find the `Dockerfile` (Root Directory must be empty).
3. **Add a volume** to the service (right-click the service, or Settings), mounted at **`/data`**. The clips, the
   login and what it has made live there; without it all is lost on each deploy.
4. Wait for the first deploy to go green (about 5 minutes: it builds the app and downloads Chrome). Its build log
   says it uses the Dockerfile.
5. On the phone: Cutter, Settings, **Server**, paste the address, **Connect**. It says how much space is free.
   Then open the app with signal for a while: the clips go up (once each), and the server starts making.

Nothing else: no keys, no variables. It uses the phone's login and posting profile, handed over by Connect.

**Plan and size.** Railway's free plan (0.5 GB of disk and 0.5 GB of memory) is too small: the disk fills
in the batch's first minutes and Chrome runs out of memory - the Cutter says so in Settings, Server, and in the
Batch tab. Hobby is enough to start. Its volume is 5 GB: the server deletes clips no batch uses any more
(after two days) and its own copy of every video once Postiz has it. If Settings shows little space left, grow
the volume (Pro plan) - nothing else changes. In a test here it used under 2 GB of memory with 1080p clips; 4K ones need more.

**One person per server.** It makes videos for the posting profile that connected it first. His friend needs a
server of their own (the same steps, their own Connect).

**Updates.** Each push to the branch rebuilds it by itself. The video being
made at that moment is made again after the restart; nothing is posted twice.

**Back to the phone.** Settings, **Make batches on this phone again**: the server stops, and the phone carries on
from what the server made.

## How it works

```
phone (serverLink.ts)                      server/main.mjs (Node, no packages)          Chrome for Testing, headless
 Settings Connect: login + profile  ---->  /connect (login checked with the            campaign.html?server=1
                                            cutter function's whoami) -> session.json  serverMode.ts: signed in as
 each clip once, 8 MB pieces  --------->   /files -> /data/files (HEVC/HDR made         the phone, always "on screen",
                                            H.264 once, by ffmpeg)                       AAC written by mediabunny's
 the bank, each change; Start over;  --->  /banks -> /data/inbox                  <-   own encoder, clips read from
   back to the phone                                                                    /local/files, the inbox every
 what it made, every 30 s  <-----------    /status <- /data/status.json           <-   10 s, its status every 30 s
                                                                                       -> videos to the postiz
                                                                                          function, as from the phone
```

- **Who owns what** (`batch.fromPhone`): his settings are the phone's (clips, headlines, looks, the number a day,
  Start and Stop); what the making has done is the server's (`PROGRESS_FIELDS`: what was made, used, which day holds
  how many). Clips used up there never come back from the phone. A new hand-over (`movedAt`) takes the phone's bank
  whole; a new Start (`startedAt`) clears what stopped it.
- **Handing over** (`batchRun.handOver`): the videos the phone had queued and not started are dropped, their mixes
  freed, and the days counted again from the posts - the server makes the rest.
- The server's Chrome runs in his time zone (the posting profile's), so days and times are his.
- The server only reads the campaigns from the shared login; it never changes them.
- Chrome is started again if it stops, or if the page says nothing for 20 minutes.

## Running it on a computer

```
npx vite build
DATA_DIR=/tmp/cutter-data DIST_DIR=dist CHROME_PATH=/path/to/chrome-for-testing/chrome PORT=8090 APP_PORT=8091 node server/main.mjs
```

`CUTTER_SERVER_TEST_TOKEN` makes that one token stand for a test login, with no login check, and
`CHROME_EXTRA_ARGS` adds Chrome switches (`--remote-debugging-port=9334`): for trying it on a computer only - never
set either on Railway. Chrome for Testing on Linux writes H.264 and reads H.264 and AAC, but not HEVC, and writes no
AAC - hence the ffmpeg step for clips and the AAC encoder in the app.

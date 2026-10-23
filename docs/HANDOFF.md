# Handoff - state on 2026-10-20 (evening), with a note from 2026-10-23

**2026-10-23, one session (commits bd80abf..):** "Cut ums" works now (see the CHANGELOG entry: whisper never wrote the
fillers; a short filler prompt, a second listen for a looping window, fillers the letter model hears between words,
and an exact-time cut between the neighbours; real-recording check in `umsFixture.test.ts`). The two crashes of
10-22 and the hidden-posts bug are fixed; status changes on the server are guarded; the Batch number box applies on
blur; posting through midnight takes its times; screens were cleaned up from screenshots at 440x956 / 402x874
(the scripts that take them are described in the UI entry - a seeded page driven by Playwright); captions stay on the
word; the hook question is a remembered switch. Not verified on an iPhone: all of it - ask him for one video with
"um"s with the switch on, and read the `check`/`ums` reports. Open: `docs/PLAN_AUTOMATION_AND_STUDENTS.md` waits
for his OK (part B is login creation). Left undone from the audits: per-row work on every progress tick in
`CampaignApp` (memoise `picturesFor`/`cuesOf`/`joinWith`), the "Post today / next days" switch could be automatic,
WideAsk could remember per campaign, headline/picture seconds and sound levels could come from the footage,
posting windows from when posts get views, three music pickers could be one, `tick()` could be time-boxed.


Read this with `CLAUDE.md`/`AGENTS.md` and the newest `CHANGELOG.md` entries. Branch
`claude/cutter-lockdown-and-map`; he ships with `cd ~/Projects/silence-cutter && git pull && ./deploy.sh`.
He wants plain words, no permission questions (questions are fine), the deploy command first.

## What is live

- His phone runs build **2026-10-20 22:20** = commit `f0a8fc8` (the newest). Check a report's `version` in
  `cutter_errors` before deciding a fix "didn't work" - twice today the fix simply wasn't deployed yet.
- In it: the freeze/lag fix for reaction starts (`1352fcf`), "More each day" for batches (`f0a8fc8`), and the
  Cutter server's phone side (`cbbcd49`, does nothing until a server is connected in Settings).
- No `supabase/functions` changes pending; the live `cutter` function already has `whoami`.
- **2026-10-22: Buffer backup for Postiz** (CHANGELOG top entry, ARCHITECTURE "Buffer, the backup") needs
  `./deploy-server.sh` then `./deploy.sh`; its migration is applied. Postiz was down from 2026-10-21 21:28 UTC
  ("Application not found" on every new call; Postiz says an outage, safe). Priority account: MediaMaxing's
  @traderzi2 = Postiz account "Michaelangelo" (`cmukq09z00404pr0ywfhhanwc`, campaign Loveable zi), 85 posts held in
  Postiz whose only copy is on uploads.postiz.com. Not tested against Buffer (api.buffer.com blocked here) - check
  `cutter_posts.buffer_ids` and errors after his first key/switch.

## Open threads

1. **Reactions laggy / frozen at the start (batch hooks).** History: clips he trims on the iPhone keep hidden
   lead-in frames before 0 (`clipParts.firstShown`, `efb7869`); some videos then froze instead
   (`1352fcf`: `steadyFrom`/`steadyStart` start a clip on its first steady frame; `writeWhole` starts a batch
   clip on its first decoded frame instead of holding it). Reproduced and verified only in Chrome for Testing,
   not on iPhone Safari. **Check first:** `select * from cutter_errors where phase = 'start' and version >
   '2026-10-20 22:20'` - every video whose start still holds or skips frames reports it, with the clip's own
   frame times. The 22:20 reaction reports (phase `reaction`) say "N hidden before the start, steady start"
   for IMG_0248-0264; his rejections line up with the hidden-frame counts (0249/0250/0252/0253/0261-0263 worst).
   **Found 2026-10-20 23:00 UTC:** build 22:20 made 21 batch videos (batch `b-mvh8zuca`, 22:22-22:29 UTC,
   montage layout, reactions incl. 0249/0250/0252/0261-0263) and sent no `start` report - so no freeze. But
   that build's check passed every-other-frame lag (gaps under 100 ms), so lag was unknown. The build after it
   (version later than 22:20) counts repeated frames in the first 45 instead ("N of its first 45 frames repeat
   the one before (M from its own R a second)"; 2+ extra reports) and covers green screen ("... (green
   screen): ..."). Green screen reactions IMG_0021-0039 are untrimmed (0 uneven), so their kept cut-outs
   (`CUTOUT_VERSION` 1) hold no lead-in; don't bump it for this.
   Videos made before 22:20 are not fixed - "Start over" in the Batch tab remakes the ones not out yet.
2. **Cutter server on Railway** (`server/`, `server/README.md`): the app itself headless in Chrome for Testing,
   making every batch day and night. Built and tested end to end here (stand-in posting function over CDP),
   not on Railway - he hasn't set it up yet (no reports from a headless device). Known limits told to him:
   Hobby volume 5 GB (it lets unused clips go after 2 days and drops its copy once Postiz has a video), one
   posting profile per server, no "Edit again" on server-made videos, Google's emoji instead of Apple's.
   The Docker image couldn't be built here (Debian mirrors blocked by the proxy); the app builds from exactly
   the image's context.
3. **Rejected batch videos are not replaced**: `filled` still counts them, so "10 a day" can mean fewer going
   out. Asked him whether to remake them automatically with a different mix - no answer yet. Don't change it
   without his yes.
4. **Grok Bot idea** (send finished videos to brands on WhatsApp/Discord, read approve / changes, approve in
   the Cutter when the brand approves, onboard campaigns): plan explained only, nothing built. Waiting on him for
   where the links go for Cantina, Lock In, Lovable BATCH, Mirage, Money Pilot, OpenArt Batch and Videotto.
5. **Formats are now scripts** (2026-10-21, his words: "one format with the same exact script ... I can say that
   30 times in 30 different videos ... half of my work is automated for the month"). Lines + takes per line, Make
   mixes one take of each line per video (`formats.mixesOf`; see the CHANGELOG entry and ARCHITECTURE.md Formats).
   Checked in Chrome for Testing up to the join (the speech model can't be downloaded here); ask him for one real
   month from his phone. Ideas not built: the app sorting a pile of takes into lines by what is said (each take is
   heard anyway), and making automatically when new takes land instead of the Make tap.

## The planner (`zziadissa117/ugc-planner`)

Netlify deploys `main` by itself; changes were pushed to `main` (and `claude/cutter-bridge-accounts`). Done and
live: the `min_views` crash (Dexie v9), the Post grid ticking boxes on its own / splitting one post into columns
(`data/cutterBridge.ts`: `mergeSplitPosts`, `joinHandColumns`, `claim`), and negative money (corrections come
off the day they correct - `redateCorrections`, `removeVideoPost(..., { correction: true })`).

## Testing real renders here

Chromium in this container can't encode H.264; Chrome for Testing can. Download
`https://storage.googleapis.com/chrome-for-testing-public/138.0.7204.168/linux64/chrome-linux64.zip`, then run
`server/main.mjs` as in `server/README.md` ("Running it on a computer") with `CUTTER_SERVER_TEST_TOKEN` and
`CHROME_EXTRA_ARGS=--remote-debugging-port=9334`; answer the Supabase functions over CDP `Fetch.requestPaused`
(pull -> one campaign, profile, posts [], start -> upload URLs on a local receiver, sent). To check a start
frame by frame, make a source where every frame is its own solid colour (ffmpeg `geq` on `N`, `scenecut=0`),
then match each output frame's mean colour to the source frames - repeated or skipped indices show a freeze or
lag. Files that froze/lagged on the old code: a stream copy cut mid-GOP (`-ss 0.5 -c copy -copyinkf`) and
every-other first frames (`select`, `-fps_mode passthrough`).

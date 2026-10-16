@AGENTS.md

# Working notes for Claude Code sessions

Read `AGENTS.md` (above) and the parts of `ARCHITECTURE.md` you touch before
changing anything; the newest entries of `CHANGELOG.md` say what changed last
and why. These notes are what earlier sessions learned the hard way.

## Branch, deploy, how he tests

- Work on `claude/cutter-lockdown-and-map`: `./deploy.sh` on his Mac pulls that
  branch and ships it (`cd ~/Projects/silence-cutter && git pull && ./deploy.sh`).
  Pushing anywhere else means nothing ships.
- After a deploy the phone keeps the old version until the Cutter is closed and
  opened again. A report's `version` field says which build made it - check it
  before concluding a fix "didn't work".
- He tests on an iPhone (Safari / home-screen PWA). His friend uses a second
  login. Nothing here can run iPhone Safari: say plainly what was and wasn't
  verified, and ask him for one real test.

## Seeing what happened on his phone

- The phone sends reports to `cutter_errors` (Supabase project
  `uykuoibqdxmpbbrsmyad`): `kind`, `phase`, `message`, `version`, `device`.
  Query it with the Supabase MCP before guessing. `src/report.ts` adds new ones.
- Each talking video sends a `check`/`colour` report (`colourCheck.ts`): source
  codec and colour, decoded frame, encoder output size and colour.
- `cutter_posts` holds every sent video: `size` and `duration` give the real
  bitrate; `status`, `post_at`, `batch`, `accounts` say where and when.
- Downloading posted videos from Postiz is blocked by the proxy here.

## Testing limits in this cloud container

- Chromium (Playwright, `/opt/pw-browsers/...`) cannot encode or decode H.264 or
  AAC, and there is no WebKit. Real renders can't be run; test the logic with
  vitest and media plumbing with mediabunny in a `// @vitest-environment node`
  test, or ffmpeg (installed) on files in the scratchpad.
- `git checkout tsconfig.tsbuildinfo` after every `tsc -b`/build.
- Checks before every push: `npx vitest run`, `npx tsc -b`, `npm run lint`,
  `npx vite build`. Add a CHANGELOG entry (newest first) for every change.

## Safari / WebCodecs facts (verified from his reports)

- Safari labels decoded frames and its encoder output as sRGB **full range**
  while the data is ordinary limited BT.709. `colourCheck.matchStreamColour`
  re-tags the MP4 from the H.264 stream's own SPS - keep it on every encoder.
- iPhones film HDR by default; HDR drawn onto a canvas comes out wrong.
- The photo picker's Format "Automatic" re-encodes his HEVC to H.264 before the
  page gets it (slow, lossy); "Current" hands over the original (`pickFormat.ts`).
- A mid-render "decoder gave up" / out-of-memory is common on long or 4K work.

## Posting limits (Instagram's API is the strictest)

- Max 1920 px across, 25 Mbps, 300 MB, 23-60 fps, index ("moov") at the front.
  So videos are made at 1080x1920, at most 20 Mbps (`quality.ts`), and
  `media/fastStart.ts` moves the index to the front of every finished file.
- mediabunny's own `fastStart: 'reserve'` fails an assertion on B-frame video -
  don't switch to it.
- What is uploaded is exactly the preview; softness after posting is the
  platform re-encoding, so stay inside its limits.

## Music

- Songs are decoded only for the seconds a video uses (`sounds.prepareMusic`).
- Batch songs are set to -14 LUFS up or down with the voice's `Limiter`
  (`montageRender.liftMusic`) - he wants every song heard, quiet or not.

## How he works

- Plain words, no jargon; he reads replies on his phone. Lead with what changed
  for him and the deploy command, then caveats.
- Ask before anything that changes how a feature behaves for him; fix bugs
  without asking. Never invent campaign content.

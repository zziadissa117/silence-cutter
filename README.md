# Silence Cutter

Cuts the dead air, the "um"s and the stumbles out of raw video, on your own
device: the videos are read, cut and handed back in the browser itself, and
are never uploaded to be cut.

Built for a UGC creator who films on a phone and finishes in CapCut, so the
first pass stops being the slow part.

There are two pages. **Cut only** (`/`) is the plain cutter described below.
**Campaign videos** (`/campaign.html`) listens to each video, sorts it into
one of your campaigns, puts that campaign's look on it - headline, logo,
pictures, sounds, captions - and can hand the finished video to Postiz to be
posted.

## Using it

Open it, add videos (drag them in, or tap to pick as many as you like), and
each one is cut in turn. When one finishes, "Send to CapCut" opens the share
sheet with the cut file - CapCut is one of the apps in that list, and "Save
Video" puts it in the camera roll.

Add the page to your home screen to keep it one tap away. Cutting works
offline once the page has been opened once. The "um" and caption options need
two downloads the first time they are used - the speech model (about 40 MB)
and its runtime (about 14 MB) - and work offline after that, as long as the
browser keeps them.

## What it removes

- **Silence.** Pauses longer than the setting, with breathing room left
  around every cut so words are not clipped.
- **"um" and "uh"**, and small words stumbled over in a row ("I-I-I").
  Optional, English only, and it runs a speech model on the device the first
  time. A cut can never reach into the words either side of a filler, so it
  leaves one in rather than risk clipping something real.

It does **not** remove coughs or laughs - those are not words, and the model
this uses only recognises speech.

## What leaves the phone

- The videos themselves never do, on either page, with the exceptions you
  ask for: a finished video sent to Postiz goes to the server and on to
  Postiz; a batch made "on the engine" or on the Cutter server (both your own,
  on Railway - `engine/` and `server/`) sends that batch's footage there to be
  made, and talking videos handed to the Cutter server are listened to and
  made there.
- With the shared login (Settings, on the Campaign videos page), campaign
  set-ups and the pictures and sounds they use are kept on the server, so the
  other phone sees them.
- When a caption is written for a post, the words heard in the video, a few
  stills from it and the campaign's caption rules go to Claude.
- When something fails, an error report goes to the server: what failed, the
  step, the version, the browser and screen, and the video's size and type.
  Never the video, never anything in it.

## Running it locally

```bash
npm install
npm run dev
```

`npm test` runs the cutting logic's tests; `npm run build` produces `dist/`.
`ARCHITECTURE.md` is the map of the whole thing - the two pages, the Supabase
functions, the engine and the Cutter server - and `AGENTS.md` the working rules.

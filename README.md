# Silence Cutter

Cuts the dead air, the "um"s and the stumbles out of raw video, entirely on
your own device. No account, no upload, no server - the videos are read, cut
and handed back in the browser itself.

Built for a UGC creator who films on a phone and finishes in CapCut, so the
first pass stops being the slow part.

## Using it

Open it, add videos (drag them in, or tap to pick as many as you like), and
each one is cut in turn. When one finishes, "Send to CapCut" opens the share
sheet with the cut file - CapCut is one of the apps in that list, and "Save
Video" puts it in the camera roll.

Add the page to your home screen to keep it one tap away. It works offline
once it has been opened once.

## What it removes

- **Silence.** Pauses longer than the setting, with breathing room left
  around every cut so words are not clipped.
- **"um" and "uh"**, and small words stumbled over in a row ("I-I-I").
  Optional, English only, and it runs a speech model on the device the first
  time. A cut can never reach into the words either side of a filler, so it
  leaves one in rather than risk clipping something real.

It does **not** remove coughs or laughs - those are not words, and the model
this uses only recognises speech.

## Running it locally

```bash
npm install
npm run dev
```

`npm test` runs the cutting logic's tests; `npm run build` produces `dist/`.

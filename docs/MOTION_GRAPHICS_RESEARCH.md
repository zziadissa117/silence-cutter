# Motion graphics with Claude - research (2026-11-07)

Research only: nothing is built yet. Written for Ziad, from his idea of 2026-11-07:

> "use Claude to do some motion graphics templates for the video ... like a sort of chatbot ... inside the Cutter,
> but in a different section ... using Maloy Studio to have some high-quality motion graphics ... paste in the video,
> type in what we want a little bit. It's going to listen to the transcript ... and make some nice motion graphics
> around the video."

## The short version

- **"Maloy Studio" is almost certainly [Malloy Studio](https://malloy.sg/)** (malloy.sg, Malloy Labs, Singapore): you
  type an idea, it makes an animated title / lower third / chart / callout, you fix text, colours and timing in its
  panels, and you **download a see-through video** (WebM or MOV with alpha) to lay over your footage. It has **no
  public API** that I could find, and it does not export an editable template file (no Lottie, no .mogrt). So the
  Cutter can't drive it automatically - only "make it on malloy.sg, download, add it as an overlay" by hand.
- The way to get what he described - paste a video, type one line, Claude listens to the words and puts graphics
  around them, then chat to fix - is to **keep our own small library of templates inside the Cutter**, and let
  Claude **choose and fill** them (which template, which words, when, where, which colours) as a small JSON plan.
  The Cutter already draws every frame itself (headline, captions, logo, pictures), so the templates are drawn
  the same way, on the phone or on his Cutter server, and the preview is exactly what gets posted.
- Claude cost: about **$0.03-0.12 per video** for the first plan and **$0.01-0.05 per chat fix** (details below).
  Rendering cost: nothing extra - same phone / same Cutter server.
- **Nothing new needs to be uploaded**: Claude only ever gets the words and their times, never the video.

## 1. How motion graphics templates work

A template is always the same idea: **a fixed animation made by a designer + a few "slots" left open** (text,
colours, a picture or video, sometimes length/timing). Filling the slots is the "data"; drawing it is the "render".

| Kind | What the template is | How data goes in | Where it renders | Can the Cutter use it? | Licence |
|---|---|---|---|---|---|
| **After Effects / Premiere .mogrt** ([Essential Graphics](https://helpx.adobe.com/premiere-pro/using/working-with-motion-graphics-templates.html)) | An AE project packed with "Essential Properties" (text, colour, sliders) | Premiere's panel, or a render service like [Plainly](https://www.plainlyvideos.com/) | Only inside Adobe AE / Premiere (or a server running AE) | Not on a phone. Only via a paid AE-render API (Plainly ~$69/mo for ~50 render minutes) | Per template (Envato, Motion Array...) - usually OK for client work, read each |
| **Apple Motion / Final Cut templates** | Motion project with published parameters | Final Cut's inspector | Only in Final Cut / Motion on a Mac | No | Apple's |
| **Lottie / dotLottie** ([lottiefiles.com](https://lottiefiles.com/)) | An After Effects animation exported as JSON (vector shapes, text, keyframes) via Bodymovin; dotLottie = zipped Lottie + pictures + "theming" slots | Change text / colours in the JSON (or dotLottie "slots" and themes) | Anywhere: browser (lottie-web, [dotlottie-web](https://github.com/LottieFiles/dotlottie-web), ThorVG wasm), iOS, Android, server | **Yes** - can be drawn at an exact frame onto our canvas (section 4) | Each file has its own licence; LottieFiles free animations are under the "Lottie Simple License" (free for commercial use, check each) |
| **Rive** | Interactive vector animation with state machines and data binding | Inputs / data binding | Rive runtime (wasm) | Possible, but heavier and aimed at app UI, not video | Rive runtime is MIT; files per author |
| **Remotion** ([remotion.dev](https://www.remotion.dev/)) | A React component = a video; "props" are the slots | JSON props | Headless Chrome (server or cloud Lambda); preview in browser | On his Cutter server, yes; in the phone's render, no (it renders DOM, not our canvas) | **Paid for companies**: free for individuals/small companies, else $25/seat/month or $0.01/render, $100/month minimum ([pricing](https://www.remotion.dev/docs/license/pricing)) |
| **Motion Canvas / Revideo** | Code (TypeScript generators) drawing on a canvas | Code / props | Browser canvas (Revideo also server) | Possible, but it's a whole second render engine | MIT |
| **Jitter, Canva, CapCut / TikTok templates** | Templates inside their own editor | Their editor only | Their app / cloud | No public way to drive them from code (Canva has an API for designs, not for timed video animation into our pipeline) | Their terms; CapCut templates can't be exported |
| **Cloud video APIs**: [Creatomate](https://creatomate.com/), [Shotstack](https://shotstack.io/), [JSON2Video](https://json2video.com/) | Their own JSON template format (text, shapes, keyframes) | JSON over HTTP | Their cloud | Yes, but **the video would have to be uploaded to them** (against rule 4 in AGENTS.md) and paid per minute (~$0.10-0.30/min, [comparison](https://www.wireflow.ai/blog/creatomate-vs-shotstack)) | Their terms |
| **Our own canvas templates** (what `overlay.ts`, `captions.ts`, `effects.ts` already are) | TypeScript functions: `draw(ctx, t, slots)` | JSON plan | The existing WebCodecs render, phone or Cutter server | **Yes, today** | Ours |

Where AI tools stand ([Submagic](https://submagic.co/), [Captions.ai](https://www.captions.ai/),
[OpusClip](https://www.opus.pro/), Veed): they all do the same trick - listen to the words, find keywords, and drop
**their own** pre-made animated captions, emoji, B-roll, zooms and pop-up titles at those moments. None of them
lets you plug their graphics into your own renderer; Submagic and OpusClip have APIs on top plans but they take the
whole video and send back their edit (upload again, against rule 4, and you lose the Cutter's own look).

Newer "LLM writes the animation" tools: Claude Code skills for Remotion ([remotion-dev/skills](https://github.com/remotion-dev/skills)),
for Lottie ([diffusionstudio/lottie](https://github.com/diffusionstudio/lottie), LottieFiles' Lottie Creator MCP and
[motion-design skill](https://claudemarketplaces.com/skills/lottiefiles/motion-design-skill/motion-design)).
They write a new animation from scratch each time. That's great for a one-off, but slow (minutes), uneven in
quality, and every result has to be checked by eye - wrong for thousands of videos a month. Picking from good,
tested templates and filling them is fast, cheap and always looks right.

## 2. "Maloy Studio" = Malloy Studio (malloy.sg)

I'm fairly sure, but not certain - the only close match for the name. What I could find (the site itself was
blocked from this cloud session, so this is from its blog, directories and reviews):

- **What it does**: type an idea -> animated titles, lower thirds, callouts, charts, counters, logo reveals. Panels
  to change text, numbers, colours, layout and timing after it's made; a "brand" (logo, colours, fonts) so
  everything matches. No keyframes. ([guide](https://www.malloy.sg/blog/mastering-malloy-studio-how-to-create-high-quality-ai-motion-graphics-in-2026),
  [AI motion designer page](https://malloy.sg/ai-motion-designer))
- **What you get out**: a **transparent video file - WebM or MOV with alpha** - to put on a track above your video
  in Premiere / Resolve / Final Cut / CapCut ([how-to](https://malloy.sg/blog/how-to-add-ai-motion-graphics-to-your-videos-without-after-effects)).
  Not Lottie, not .mogrt, not code.
- **Price**: free start (about 5 exports); paid plans reported at $19-49/month; one listing says the top plan gives
  1,000 exports a month without watermark. Reports disagree - check malloy.sg.
- **API / automation**: **none found**. A comparison site says "API available: No" ([aigearbase](https://aigearbase.com/tool/malloy-studio)).
  There's a ChatGPT app for it, which is a chat front end, not an API we can call.
- **Licence**: couldn't read their terms from here. Need to check that exported graphics can be used commercially
  on client accounts.

**What that means for the Cutter**: Malloy can't be "combined with Claude" inside the app - there's no way for the
Cutter to ask it for a graphic. Two honest ways to still use it:
1. **By hand, for special videos**: make the graphic on malloy.sg, download the transparent file, add it with the
   existing "+ Overlay" (CutsEditor / `manualPictures.ts`). Needs a check: the overlay path must keep the
   see-through part. mediabunny can decode alpha (`alpha: 'keep'`, `canBeTransparent()`), but whether iPhone Safari
   decodes VP9-with-alpha WebM, or Apple's HEVC-with-alpha MOV, through WebCodecs is **not verified** and is the
   kind of thing only a real iPhone test answers. The Cutter server (Chrome) decodes VP9 alpha.
2. **As the look to copy**: use Malloy's style (clean titles, counters, lower thirds) as the brief for our own
   templates, which Claude can then drive automatically.

## 3. How Claude picks and fills templates (and how the chat works)

The Cutter already has the words with exact times (on-device whisper + `align.ts`, `plan.spoken`, `wordMoments`).
The steps:

1. **Words in** - the transcript as short lines with times, e.g. `[12.40-13.10] "three things"`. A 60 s video is
   roughly 150-200 words, ~1,500 tokens with times. **No video, no audio** leaves the phone.
2. **Template menu** - a fixed list of our templates with their slots and rules, e.g.
   `counter {value, label, colour}`, `list {items[≤4]}`, `keyword-pop {word}`, `lower-third {name, role}`,
   `stat-card {number, unit, caption}`, `quote {text}`, `arrow-callout {text, target}`, `progress-steps`,
   `emoji-burst`. ~3-5k tokens, the same every time (prompt-cached, so ~10x cheaper after the first call).
3. **His one line** (optional) - "make it punchy, show the 3 steps as a list, brand colours".
4. **Claude answers with a plan** - structured output (JSON schema, so it can't be malformed):
   ```json
   {"items": [
     {"template": "counter", "from": 3.2, "to": 5.0, "slots": {"value": 3, "label": "mistakes"}, "place": "top"},
     {"template": "list", "from": 12.4, "to": 19.0, "slots": {"items": ["Hook", "Proof", "Offer"]}, "place": "middle"}
   ]}
   ```
   The app checks it (times inside the video, not over the face / captions / headline, at most N at once) and fixes
   what it can by itself.
5. **Preview** - drawn by the same render code, so the preview is exactly the posted video.
6. **Chat to fix** - "make the title bigger", "move it to the top", "drop the second one", "red instead of yellow".
   Claude gets the current plan + the message and answers with **small changes to the plan** (a list of
   "set item 2 place = top", "set item 1 scale = 1.3", "remove item 3"), not a new video. Each fix is cheap,
   fast, and can be undone. Things he can do with a finger (drag, pinch, delete) stay direct, like the headline in
   CutsEditor today - the chat is for what's quicker to say than to do.
7. **Learn** - fixes he makes often become the default for that campaign (same spirit as `batchFavour.ts`), so
   after a few videos the first plan needs no chat at all.

## 4. Can it run in this app?

**Our render** (`render.ts`, `montageRender.ts`) draws each frame on an `OffscreenCanvas` at an exact time `t`,
then hands it to the WebCodecs encoder. Anything that can "draw yourself as you look at time t onto this canvas"
fits. Options:

| Option | Fits the render? | Same frame every time (seek to t)? | Size | Phone speed (estimate, to measure) | What leaves the phone | New dependency? |
|---|---|---|---|---|---|---|
| **A. Our own canvas templates** (TypeScript, like `overlay.ts`) | Yes, natively | Yes - it's just maths on `t` | ~a few KB each | Cheap: like the headline today, ~1-3 ms a frame | Only words to Claude (via our `postiz` function) | No |
| **B. Lottie via [dotlottie-web](https://github.com/LottieFiles/dotlottie-web)** (ThorVG wasm; has `setFrame`, and a worker + OffscreenCanvas version) | Yes - draw into its own canvas, then `drawImage` onto ours | Yes (`setFrame(n)`) | wasm renderer, roughly 1-2 MB (not measured) + each animation 10-200 KB | ~2-10 ms a frame per layer at 1080x1920 -> +5-20 s on a 60 s video | Same as A | **Yes - needs his OK** |
| **C. Lottie via lottie-web** (canvas renderer, `goToAndStop(frame, true)`) | Mostly; it expects a page (fonts, images through `document`) - fine on the page, less in a worker | Yes | ~250-300 KB JS | Similar or a little slower than B | Same as A | **Yes - needs his OK** |
| **D. Remotion / HTML on the Cutter server** | No - it renders web pages, not our canvas; would be a second pipeline and a second encode | Yes | Big (React + Chrome) | Server only | Raw video already goes to his server (`talkOrder.ts`) - allowed | Yes, and a paid licence for a company |
| **E. Cloud API** (Creatomate / Shotstack / Submagic) | No | - | - | Their cloud | **The video to a third party - not allowed by rule 4** | No package, but a new service |
| **F. Engine (Python + ffmpeg)** | Would need Lottie rendered to frames first (e.g. rlottie / Skottie) then overlaid by ffmpeg | Yes | Server | Server only | The bank already goes there when he makes a batch there | Server-side packages |
| **G. Malloy (by hand)** | Its transparent video as an overlay | Yes | One file per graphic | Decoding a second video costs memory - iPhones already run out on long/4K work | Nothing extra | No (if alpha works - test) |

The Cutter server is the same app in Chrome for Testing, so options A-C run the same on the phone and on the
server: a batch made at night gets the same graphics.

Two things to watch:
- **Phone memory**: the iPhone already gives up on long / 4K renders ("decoder gave up"). Vector templates (A, B,
  C) cost little memory; a second decoded video (G) costs a lot.
- **Fonts and emoji**: templates must use fonts we ship and the Apple-emoji pictures we already use for the server
  (`emojiSprites.ts`), or the server's video won't match the phone's.

## 5. Recommended first version

**"Graphics" - a new section under More** (his ask: not in the Videos section), switched on/off per campaign and
per video, with "for certain videos" as the default (off unless asked).

1. **Pick a video** (made or in the bank) -> the app already has its words and times.
2. **One line, optional** ("show the 3 tips as a list"). Nothing typed = Claude decides from the words.
3. **Claude plans** (in our `postiz` edge function, his key, like captions/headlines today), the app checks the plan.
4. **Preview** with the graphics; **chat box under it** for fixes; drag/pinch for position like the headline.
5. **Make** - same render, phone or Cutter server; the plan is saved on the video so "Edit again" keeps it.
6. Later: **"Graphics on every video of this campaign"** switch - batch videos get a plan automatically, no chat.

Build order: start with **option A** (our own canvas templates - no new dependency, works on the phone and the
server today, nothing uploaded). 8-12 templates cover most talking-head graphics: keyword pop, counter / big
number, list / steps, lower third, stat card, quote, arrow callout, progress bar, emoji burst, "before/after" split,
price tag, logo sting. If he wants designer-made animations from LottieFiles / Malloy-style later, add **option B
(dotlottie-web)** - that needs his OK for the new dependency.

**Claude cost** (prices from Anthropic's price list, Nov 2026; the `postiz` function uses `claude-opus-5` today):

| Model | First plan (~6k in, ~1.5k out + thinking) | Each chat fix | 3,000 videos a month, 1 fix each |
|---|---|---|---|
| Claude Opus 5 ($5 / $25 per M tokens) | ~$0.08-0.12 | ~$0.03-0.05 | ~$330-500 |
| Claude Opus 5.5 ($4 / $20) | ~$0.06-0.10 | ~$0.02-0.04 | ~$250-400 |
| Claude Sonnet 5.5 ($2 / $10) | ~$0.03-0.05 | ~$0.01-0.02 | ~$120-200 |
| Claude Haiku 5.5 ($0.10 / $0.50) | well under $0.01 | under $0.01 | under $10 |

The template menu is the same every time, so prompt caching cuts the input part by ~90% after the first call.
Sensible split: the stronger model for the first plan (taste matters), a cheaper one for small chat fixes.

**Render time**: the first plan comes back in ~5-20 s. The render itself costs a few % more than today with option
A, roughly +5-20 s on a 60 s video with option B (estimates - to measure on his iPhone).

**What goes where**: words and times -> our Supabase `postiz` function -> Anthropic (same as captions/headlines
today). Video -> nowhere new (phone, or his own Cutter server as now). Nothing to Malloy, Remotion or any cloud
render service.

## Open questions for him

1. Is it **Malloy Studio** (malloy.sg) you meant? Have you used it - which kind of graphic did you like there
   (titles, counters, lists, lower thirds, charts)? A screenshot or 2-3 example reels of the look you want would
   decide the first templates.
2. **Automatic or chat first?** Should Claude put graphics on by itself (you only fix if needed), or always wait
   for your line? And on which videos: one-offs only, or also a switch for whole campaigns / batches?
3. **Brand**: same colours/fonts as the campaign's headline, or a separate graphics style per campaign?
4. **New dependency OK?** Our own templates need nothing new. Designer-made Lottie animations need a ~1-2 MB
   player (dotlottie-web). Yes / later / no?
5. **Malloy by hand**: do you want "add a Malloy file" as an overlay for special videos? (Needs one real iPhone
   test with a downloaded WebM and MOV to see if the see-through part survives.)
6. **Model and budget**: OK to spend roughly $0.05-0.10 a video on Claude for this, or keep it cheaper (Sonnet /
   Haiku for fixes)?
7. Can you check Malloy's terms (or send me the page) - commercial use on client accounts, and whether there's an
   API on the top plan? Their site was blocked from my cloud session.

## Sources

- Malloy Studio: [malloy.sg](https://malloy.sg/), [AI motion designer](https://malloy.sg/ai-motion-designer),
  [how to add AI motion graphics](https://malloy.sg/blog/how-to-add-ai-motion-graphics-to-your-videos-without-after-effects),
  [quality guide](https://www.malloy.sg/blog/mastering-malloy-studio-how-to-create-high-quality-ai-motion-graphics-in-2026),
  [aigearbase listing](https://aigearbase.com/tool/malloy-studio), [navtools listing](https://navtools.ai/tool/malloy-studio),
  [Klypr vs Malloy review](https://www.tryklypr.com/blog/klypr-vs-malloy-studio)
- Lottie: [dotlottie-web](https://github.com/LottieFiles/dotlottie-web), [LottieFiles AI tools](https://lottiefiles.com/ai),
  [diffusionstudio/lottie](https://github.com/diffusionstudio/lottie), [text-to-lottie skill guide](https://mcp.directory/blog/claude-text-to-lottie-skill-guide)
- Remotion: [licence pricing](https://www.remotion.dev/docs/license/pricing), [license FAQ](https://www.remotion.dev/docs/license/faq),
  [remotion-dev/skills](https://github.com/remotion-dev/skills), [Remotion skills with Claude Code](https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code)
- Video APIs: [Creatomate vs Shotstack](https://www.wireflow.ai/blog/creatomate-vs-shotstack), [Shotstack pricing](https://www.wireflow.ai/blog/shotstack-pricing),
  [JSON2Video pricing](https://www.wireflow.ai/blog/json2video-pricing), [Plainly video APIs](https://www.plainlyvideos.com/blog/best-video-editing-api)
- AI editors: [Submagic B-roll](https://submagic.co/features/b-roll), [Captions vs Submagic vs OpusClip](https://filmfont.pages.dev/articles/captions-ai-vs-submagic-vs-opus-clip)
- In this repo: mediabunny alpha decode (`alpha: 'keep'`, `InputTrack.canBeTransparent()` in `node_modules/mediabunny/dist/mediabunny.d.ts`)

Not verified here (needs a real iPhone or his account): Safari decoding of transparent WebM/MOV through WebCodecs,
dotlottie-web speed and size on an iPhone, Malloy's current prices, terms and API.

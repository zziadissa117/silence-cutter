# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

## Fix: the tab bar rode up the screen when scrolling
**What:** On an iPhone, scrolling down a long screen (Settings, the Videos list) made the bar along the bottom -
Videos, Batch, Campaigns, Pictures, Settings - move with the scroll instead of staying at the very bottom.
**Why:** the bar was fixed to the bottom of a page that scrolls, and Safari moves that page's own viewport as it
scrolls (its toolbars, the bounce), taking the bar with it.
**Fix:** the screens with the bar are now a frame the size of the screen that never moves: the screen scrolls
inside it and the bar is its bottom row, so there is nothing for the bar to move with. Scrolling past the end
bounces the list, not the whole screen. The last line of every screen still clears the bar. Opening something
full-screen (checking captions, an editor, posting setup) and coming back leaves the list where it was; switching
tabs starts the new tab at its top, as before. The full-screen views scroll as they always have.
**Checked:** in a phone-sized Chromium, Settings (2,647 px tall) scrolled to the bottom with the bar staying at
exactly the bottom of the screen, and the list kept its place across posting setup. Not yet on an iPhone.
Files: `CampaignApp.tsx`, `TabBar.tsx`, `campaign.css`.

## Fix: pictures and the logo came up late after the word
**What:** Say "Hershey's" and its picture came up a good part of a second later, while the caption was already
on the word. Pictures (the angle's and the bank's) and the logo now come up the moment the word is said - a
touch before it, in fact, so they are fully on screen as it lands.
**Why:** the captions are timed by the letter model, which places each word within a frame or two of your voice,
but the pictures were still timed from the speech model's rough times - about 0.2 s late on average and wandering
0.2 s either way, worst in the middle of a sentence, where nothing pulls a word back onto your voice. On top of
that, a picture fades in over its first 0.12 s, so it was seen later still.
**Fix:** everything that comes up on a word - pictures, bank pictures, the logo, sounds and the brand-hit zoom -
is timed from the same exact words as the captions. Pictures and the logo start 0.1 s before the word; sounds and
the zoom land on the word itself. A picture you put on by hand stays exactly where you put it.
**Note:** a video already read keeps its words, and those already have the exact times if captions were on - so
making it again (or Edit again) is enough; it does not need adding fresh. If the letter model could not run, the
pictures use the same timing as the captions did.
Files: `moments.ts` (new), `moments.test.ts`, `pipeline.ts`.

## Change the headline when you edit a video again
**What:** The screen you land on after "Edit again" (the captions screen, with the Cuts button) now has a
**Headline** box under the video, beside the caption position and size. Change the words there and make the video
again; the new headline is on the new video and replaces the old post (if it hasn't gone out).
**Before:** the headline could only be changed in the video's list row, which you had to open and find. Batch
videos already had a headline box in their own Edit screen.
**How:** the box is the same headline the list row edits (`setHeadline`/`saveHeadline`), saved when you leave it.
Files: `CaptionReview.tsx`, `CampaignApp.tsx`.

## Fix: cutting "um"s could take a quietly said word out with it
**What:** With "Also cut "um"s and stumbles" on, an "um" cut checks the sound it is about to remove and
refuses when there is more in it than an "um" could make - that is what stops a mistimed "um" taking a real
word with it. But it judged "sound" by the slider's fixed number (-35 dB), while the pauses have long been
found with a line measured on each take, because his quieter words sit at -35 to -39 dB. In a quiet take a
quiet word looked like silence to the "um" check, so a word the speech model ran into the "um" was cut with
it (a test reproduces it: "so um this works" lost "this").
**Fix:** the "um" and stumble checks now use the take's own line. It is never above the slider's number, so
the check can only get stricter: an "um" is left in rather than a word taken out. Nothing else changes.
**Not changed:** the plain cutter, which has the same check, is left exactly as it is (it is kept unchanged
on purpose); say if it should get this too.
Files: `plan.ts` (`fromHeard`), `plan.test.ts`.

## Fix: a setup change could miss the other phone; the word-timing step starts more reliably; a clearer message for clips with no talking
**What:**
- **Sync between the two phones.** A change to a campaign, angle or bank picture is stamped with the time the
  server handled it, not the moment it was saved. One saved while the other phone was reading could land just
  behind where that phone had read to, and never reach it (until it was edited again). Each sync now looks
  back two minutes; taking a change twice is harmless, since only a newer change is ever kept.
- **Word timing ("letter model") running out of memory as it starts.** It started the instant the speech
  model's worker ended, before the phone had taken that memory back ("no available backend found ... Out of
  memory", on both phones). It now waits a moment first, and has one more go if it still can't start for
  memory.
- **"The whole video looks silent. Try recording somewhere quieter."** shown for 33 clips in a minute on
  Oct 2 - clips with no talking in them. The advice was backwards. It now says no talking could be heard,
  that a clip with no talking goes in Batch, and to record closer to the phone if you do talk in it.
Files: `cloud.ts` (`pullFrom`, `readTo`), `cloudPull.test.ts`, `plan.ts`.

## Fix: the plain cutter no longer loses a whole batch when the phone is short of memory, and picks up after the decoder gives up
**What:** Three failures from the app's own error log:
- **Twelve videos failed in six seconds.** On the plain cutter (this morning, 08:05), the speech model
  could not get the memory it needs to start ("Out of memory"), and every video in line after it failed the
  same way within a second - and was dropped from the list. Now a video whose speech model can't start is
  still cut (pauses only) and says what it went without: "The phone had no memory left for the speech model,
  so only the pauses were cut - "um"s were left in. Close other apps, reload this page and add it again to
  try with it."
- **"Decoder failure" on long videos.** The plain cutter failed outright when the phone's video decoder gave
  up partway through a long take (90-335 MB, Oct 1 and today). It now picks up from the last frame written,
  up to four times (waiting first if the app was in the background) - what the campaign videos already do
  ("Decoder gave up 1 time(s) mid-video; carried on from the last frame and finished").
- **Joining recordings failed** on a phone whose encoder would not take the very high quality used for the
  joined file ("This specific encoder configuration ... is not supported"). It now steps down to the quality
  every other video is made at.
**Note:** Safari's "Can't find variable: EmptyRanges" error in the log comes from inside Safari's own video
code at the moment one of its encoders or decoders fails; the app only reports it.
Files: `App.tsx`, `media/silenceCut.ts`, `media/recovery.ts` (shared with `campaign/clipParts.ts`),
`campaign/joinRender.ts`.

## Fix: captions on the wrong word because the word-timing step kept failing on phones
**What:** Captions are timed by a second, small model that finds each word's exact moment (the "letter
model"). On phones it kept giving up: the app's error log has it running out of memory or going quiet for
over a minute 7 times since Sept 28, on both phones that use the cutter, 3 of them since Oct 5 (one this
morning, on the newest version). Every time it gave up, that video's captions fell back to the speech
model's rough times: words come up about 0.2 s off and the last word before a pause can be lost, so on fast
talk the word on screen is often not the word being said.
**Why:** it listened to a whole listening window at once - up to 25 s of sound. The memory it needs, and the
time before it says anything, grow with that length; 25 s was too much for an iPhone.
**Fix:** it now hears each window in pieces of at most 8 s, always cut in the middle of a pause (never in a
word), and reports in after each piece and once it has loaded. The letters it hears are joined back up and
the words are laid along the whole window at once, exactly as before - tested to give the same times as
hearing the window whole.
**Not a setting:** no setting changed the words. The caption text stored with every video posted since
Sept 28 (both posting accounts) is as accurate as on day one. The one setting that did hurt was "Also cut
sounds that aren't speech" (on by default from Oct 3 until the Oct 6 02:13 update); it is off now.
**Reaction videos:** their captions come from the product clip's sound, not the face clip. If the product
clip is a screen recording with music or quiet narration, the words heard from it can be wrong - check them
in the caption check, or make that video without captions.
**To test:** update the app (tap the update banner), then add videos fresh - a video already read keeps the
times it was read with.
Files: `align.ts` (`pieceCuts`, `joinPieces`, `placeWordsAt`), `align.worker.ts`, `plan.ts`, `align.test.ts`.

## Checked: cuts and captions match the cutter before noise cutting; a portrait clip is never left uncut by mistake
**What was checked:** the whole path from reading a video to the cut and the captions, against the
version just before noise cutting existed. With noise cutting off (the default) the pause finding, the
"um"/stumble cuts, the word timing and the caption words run the very same code as before - the only
additions are the loudness picture under the Cuts timeline and the caption size, which don't change what is
cut or heard. Nothing else in that path changed.
**New tests** (`plan.test.ts`): a made-up talking video - room hiss, words fading in and out, short breaths
inside sentences, real pauses between them - with the speech model's words timed the way it really times
them (a bit early or late, each word's end stretched over the pause after it). They check every pause is
cut, every word is kept whole (a quiet one too), the breaths inside a sentence stay, and the caption words
are exactly what was said with nothing added. Run against the noise-cutting version that made the cuts
worse, they fail exactly the way you saw it ("pause left 0.90 s"); now they pass.
**Fix (noise cutting, when you turn it on):** a cough or bump in a pause was never cut, for the same reason
the pauses came back - the speech model's stretched word ends made the cough look like part of a word. A
word now counts only where it starts, so the cough is cut (and listed).
**Fix (wide clips):** "Only make 9:16 - don't cut" leaves every pause in, so it is now only asked about
clips that really are wide: landscape, square or 3:4 (Meta glasses). A clip filmed on a phone held upright
- 9:16, or a taller phone screen like 9:19.5 - is never asked and always cut (it is still cropped to exact
9:16). A video you did choose "only make 9:16" for now says "not cut, only made 9:16" on its row.
**To test:** a video already read keeps the cuts and captions it was read with. Add videos fresh.
Files: `plan.ts` (`fromHeard`, `plainKeep`, `noiseCandidates` - the same steps, now testable),
`plan.test.ts`, `noiseCuts.ts` (`loneSounds`), `framing916.ts` (`isUpright`), `filming.ts`, `JobRow.tsx`.

## Fix: cuts and captions are back to how they were (noise cutting is now off by default)
**What:** After the noise-cutting update, talking videos cut worse than before and the caption words got
worse too. Noise cutting is now **off by default**: cuts and captions run exactly the code they ran before it
existed (nothing else in the cutting or caption-hearing code changed). You can still turn it on in Setup
("Also cut sounds that aren't speech").
**Why it hurt:** the noise step re-listened to stray sounds with the speech model, and whatever that second
listen "heard" was added to the caption words - models make words up from noise ("you", "thank you") - at
the wrong times. It also protected words by their stretched timings, which put pauses back (fixed earlier).
**Fix:** off by default; and when on, the second listen only decides whether a stretch stays - it never adds
words to the captions.
**Note:** if you had switched it on yourself before, it stays on. A video already read keeps its old cuts and
captions: add it again.
Files: `noiseSetting.ts`, `plan.ts`, `SettingsView.tsx`.

## Fix: pauses were not being cut in talking videos (the Cuts view looked uncut)
**What:** In a talking video, the Cuts view showed most pauses still in - the cuts were far shorter than the
cutter used to make, or missing.
**Why:** The noise step I added protects every word the speech model heard, by its start and end times. The model
stretches a word's end across the pause after it, often right up to the next word, so the "protected" span covered
the whole pause and the pause was put back.
**Fix:** A word is now judged by its start: it counts as cut only when most of its first half second was cut, and
only that half second is brought back. A long tail over a pause is ignored, so pauses are cut as before. A quiet word
that really was cut inside a silence is still protected.
**Note:** A video that was already read keeps the cuts it was read with. Add it again (or use Edit again) to get the
new cuts.
Files: `noiseCuts.ts` (`protectWords`), `noiseCuts.test.ts`.

## Usernames, not just names, on your Postiz accounts
**What:** Accounts are listed by their username first - "@kari.ugc · TikTok (Kari)" -
wherever you pick or see them (campaign posting setup, daily limits, Posts, late-account
catch-up), so accounts that share a name can be told apart. With no username it falls back
to "Kari · TikTok".
**How:** Postiz already sends each account's username (`profile`); the app was only showing
the name. `accountLabel` now leads with it, and new posts keep it with their accounts (older
posts show the name as before).
**Note:** The username comes from Postiz's own account list. If one account shows no
username there, it shows its name.
**Needs deploying:** the `postiz` function (so posts keep the username).
Files: `posting.ts` (`accountLabel`, `handleOf`), `postiz/index.ts`, `postiz/limits.ts`.

## Add music after the video is finished (Posts screen)
**What:** On a post waiting in Posts (waiting for approval, approved, or scheduled for later)
you can add music to the finished video.
**Use it:** Posts, the post, "Add music": pick a track (an angle's, one from the batch bank,
or "From my phone"), Normal or Quieter, "Add music". It takes seconds. The new version is
sent and the old post is taken back. The caption, title and per-platform captions you
already had come with it, and a batch video keeps its day and time.
**How:** `addMusic.ts` copies the video's encoded picture across untouched (no re-render, no
quality loss) and only redoes the sound: the video's own sound with the track mixed under
it exactly as music goes under a voice when a video is made (set under the voice, dipping
while you talk, fading in and out, looping if short, through the limiter). The video comes
from this phone's copy, or Postiz's if the phone has let go of it. The post is replaced the
same way Edit again does it (new key `id~2`, old one rejected after the new one is safely
queued).
**Limits:** Music goes on top of whatever sound the video already has; to swap a track, use
Edit again. A post that already went out can't be changed. The new version takes the next
free posting time rather than the exact time the old one had (a batch video keeps its slot).
**Needs deploying:** the `postiz` function (the new version carries the caption over).
Files: `addMusic.ts`, `musicAfter.ts`, `MusicAfter.tsx`, `PostsView.tsx`, `postiz/repost.ts`.

## Caption size
**What:** Captions can be made smaller or bigger, as well as moved.
**Use it:** In the caption check, under the Top / Middle / Usual / Bottom row: Small,
Normal, Large, Huge. The preview changes at once. Settings, Captions sets where new videos
start. Normal is what captions have always been; the others are 0.75x, 1.25x and 1.55x.
A long word still shrinks to fit the screen.
**How:** `captions.ts` `CAPTION_SIZES`, saved per video (`day.captionSize`), used by talking
and reaction videos.

## Put a picture on the video at a moment you pick
**What:** In the cuts editor you can add a picture that comes up at a time you choose, from
the picture bank or from your phone.
**Use it:** Open the video's cuts (Edit cuts, or Cuts from the caption check). Scroll the
timeline so the playhead is where the picture should come up (on a kept part), tap
"+ Picture", then "From my phone" or tap one from the bank. It appears on the timeline as a
small picture bar and on the video preview while the playhead is over it. Under "Pictures on
this video" set how long (1-8 s), where (top, corners, middle) and how big, tap one to jump
to it, or Remove. It starts with the angle's picture-bank spot, size and length.
**How:** A picture put on by hand is another picture cue for the render, shown at the
moment you picked instead of when a word is said, so it gets the same spots and spring-in
as the angle's pictures. Phone pictures are kept with that video for the 2-hour edit window
(then go with it); bank pictures are the bank's own. If a picture's image can't be found when
the video is made, it is left off and you are told. Edit again keeps your pictures.
**Limits:** Talking videos (the ones with a cuts editor). A moment that ends up in a part
you later cut out comes up at the start of the next kept part.
Files: `manualPictures.ts` (+ test), `CutsEditor.tsx`, `pipeline.ts`, `store.ts`.

## Re-check captions with Claude (optional, costs credits) + only review what's flagged
**What:** A button in the caption check: "Use Claude to re-check captions · costs credits ·
about N¢". It fixes words the phone's small speech model misheard (brand and product names
above all) using the campaign's own names, and nothing else. Off unless you tap it, so use
it when you're rushed. Needs posting set up (it uses your Anthropic key).
**Cost:** The estimate before you tap is from the length of the captions (a normal video is
a few cents). After it runs it says what it actually cost, from the tokens the API reported
(Claude Opus 5 at $5 in / $25 out per million tokens, checked 2026-09-25).
**Safe:** Claude must return the same number of phrases in order, and a fix is only taken
if it stays close to what was heard (a spelling fix, not a rewrite; at most one word more or
fewer). Anything else keeps the original phrase. Fixed phrases are highlighted green and
there is an Undo.
**Only review what's flagged:** "Only show the N to check" hides the rest. A phrase is
flagged when Claude changed it, when a word nearly matches a campaign name (like "pump fund"
for Pump.fun, or a name split in two), or when it sits next to a sound the cutter cut or was
unsure about. Flagged ones have an amber edge.
**Needs deploying:** the `postiz` function (new action `recheck-captions`).
Files: `postiz/recheck.ts` (+ test), `captionFlags.ts` (+ test), `CaptionReview.tsx`.

## Cut noises, never words (with a checker) + a brighter cuts editor
**What:** The cutter now also cuts sounds with no speech in them (cough, bump, room
noise), and tells you about anything it cut that could have been a word.
**Safety, in order:** (1) any word the speech model heard is brought back whole with a
little room either side, so a heard word is never cut (except the "um"s and stumbles you
chose to cut). (2) A sound with no word in it is listened to a second time on its own; if
a word turns up, it stays and the word joins the captions. (3) Whatever is still cut that
could have been a word is listed with its exact time, length and loudness. A long sound
with no words (over 2.5 s) is never cut, only pointed out. If almost everything looks
like noise, nothing is cut and it says so. If the second listen fails, nothing is cut.
**Use it:** Settings, Noises (on by default; every video is listened to, so it takes a
little longer). On a video row: "N sounds to check" and a "Check cuts" button. In the cuts
editor, "Check these" lists each sound with Listen / Put it back / Cut it; short clicks are
under "Short noises cut". Each is also marked on the timeline with an amber ? box.
**Cuts editor:** kept parts are green, cut-out time is red-striped, the sound's waveform
is drawn across, amber marks flag what to check, and there is a legend. Bigger parts.
**How:** `noiseCuts.ts` (pure, tested), `plan.ts`, `CutsEditor.tsx`. Videos made with
captions off also keep what was heard, so Edit again works for them.
**Limit:** "Never cuts a word" means a word the model heard; a word it missed twice and
that sits alone with silence on both sides can still be cut - that is what the list is for.

## Fix: "Cannot access 'nr' before initialization" crash
The Videos list crashed the whole page when it had a video row. Cause: the per-video
pictures list (added with "leave one picture out") was called while the page was being
drawn, but defined further down in the same component. Now declared as a function so it
exists when the list draws. Videos waiting come back on reload, as the error says.

## Wide clips: cut them, or only make them 9:16
**What:** When you drop in a video that is not 9:16, the cutter asks: "Cut them and make
9:16", or "Only make 9:16 - don't cut" (every moment stays in). Videos that are already
9:16 are never asked about and are always cut.
**Use it:** Drop videos in as usual. If any are not 9:16, a screen lists them and asks once
for the whole drop. "Don't add them" skips the wide ones (any 9:16 ones in the same drop
are still added and cut).
**How:** `filming.ts` reads the picture size (rotation applied) and sets `vertical`
(`framing916.is916`). A clip whose size can't be read is treated as 9:16: no question, cut.
"Don't cut" sets `noCut` on the video; `plan.ts` `keepWhole` keeps the whole recording
(words are still heard for captions and the logo) and the render makes it 9:16 even when
Settings, Wide clips is Off. Headline, captions and effects still go on; only the cutting is skipped.
Files: `WideAsk.tsx`, `CampaignApp.tsx` (`commitAdd`), `plan.ts`, `pipeline.ts`, `render.ts`.

## Edit again for batch videos
**What:** A batch video can be fixed after it was made: its headline and its music track.
**Use it:** Posts, the video, "Edit again · ... left", change the headline or pick another
track (or none), "Make it again". The old post is replaced if it hasn't gone out; if it
already posted, the edit goes out as a new post and says so.
**How:** The batch video's footage is the bank's and is kept while a job row names it, so the
(small) row is kept for the 2-hour window (`markMade`) instead of being forgotten, and the
bank sweep leaves the footage alone until it expires. `store.peekMadeBatch` /
`reopenBatchJob`, `BatchEdit.tsx`, `CampaignApp.makeBatchAgain`. Same replace-the-post path
as talking videos (`id~2`, `retireOld`).
**Not covered:** swapping which reaction or product clip it uses (that is a different
video).

## Reaction and montage videos get default effects and caption position
**What:** The default effects (Settings) and the caption position now apply to batch
videos too. Reaction: a slow push-in as it opens and a punch at the switch to the product.
Montage: a punch at each clip change. Captions on a reaction's product clip sit where you
chose.
**How:** `effects.ts` `zoomPlace` zooms a cover-filled clip and keeps the canvas covered;
`reactionRender.ts` / `montageRender.ts` plan one move per stretch with the same
`planMotion` the talking videos use, seeded per video. The logo/picture spring-in and
the brand punch do not apply (those renderers have no logo or brand words).
**Note:** There is no per-video "No effects" for batch videos yet (their rows are not
shown); turn the default off in Settings to stop them.

## Reminder to repost (replaces the earlier "repost it again")
**What:** Postiz cannot press the platform's own Repost button on TikTok or Instagram (its
auto-repost is for X only), so the app reminds you instead. Campaign, Posting, Repost:
"Remind me to repost it" after 3 / 7 / 14 / 30 days. When the time comes you get a
notification with the post's link, and the post shows "Time to repost" for 3 days.
**How:** `postiz/index.ts` `remindReposts` (runs on the 5-minute tick, told once per post).
The earlier re-upload repost is gone.

## Auto-repost, and a caption per platform
**Repost:** replaced - see "Reminder to repost" above. (It first re-uploaded the video as a new post; that was not what was wanted.)
**Caption per platform:** On a waiting post with more than one account, "A different
caption for one platform" lets you write one for just that account; accounts left blank
use the main caption. Saved on the post (`captions`), used when it is sent to Postiz,
including accounts linked late.
**Needs deploying:** the `postiz` function (`npx supabase functions deploy postiz
--project-ref uykuoibqdxmpbbrsmyad`). Database columns were applied 2 Oct.
Files: `postiz/repost.ts` (+ test), `postiz/index.ts`, `PostingEditor.tsx`, `PostsView.tsx`.

## Move the captions (top / middle / bottom)
**What:** Captions no longer have to sit where your face is.
**Use it:** In the caption check (the editor), under the video: Top, Middle, Usual or
Bottom. The preview moves at once and the video is made with that position. Settings,
Captions sets where new videos start (Usual = where they have always been).
**How:** `captions.ts` `CAPTION_POSITIONS` (caption centre at 20%, 50%, 63%, 80% of the
height); the choice is saved on that video (`day.captionPosition`) and passed through
`make` to the render. Files: `captions.ts`, `CaptionReview.tsx`, `render.ts`, `pipeline.ts`.
**Limit:** Talking videos. Reaction videos still use the usual place.

## Leave one picture out of one video
**What:** A photo that popped up on a word you said in passing can be dropped from
that video only.
**Use it:** Open the video's row (before approving, or after Edit again) → "Pictures in
this video" lists each picture that will appear, with a tick. Untick to leave it out,
then approve (or re-make).
**How:** `skipPictures.ts` lists the pictures whose words were heard, using the same
matching as the render. The unticked ids are saved on the video (`day.skipPictures`) and
filtered out in `videoLook`. Files: `skipPictures.ts`, `look.ts`, `JobRow.tsx`.

## Proposed: planner bridge (design only)
`docs/PLANNER_BRIDGE_PROPOSAL.md` - how a cutter "posted" post would auto-tick the
planner without exposing your cutter data to other planner users. Needs your OK.

## Music library: names and a player
**What:** Every track in the batch bank has a ▶/■ button and a name you can change;
every made talking video says which track is under it.
**Use it:** Batch tab → Music: tap ▶ to hear it, tap the name to rename (Enter
saves). Made videos list "music: <name>" in their row.
**How:** `TrackPlayer.tsx` plays the stored file through an `Audio` element (object
URL freed on leave). Rename changes only the label in the bank row, not the file.
`CampaignResult.music` carries the name. Per-video track choice already existed
(row → Music) and Edit again re-renders with a new one.
**Not yet:** a swap-music-for-the-whole-batch button; a track in the
angle editor still shows its filename as before.

## Proposed, not applied: repost + per-platform captions columns
`supabase/proposed/20261002120000_cutter_posts_repost_captions.sql` adds four
nullable columns to `cutter_posts` (`repost_of`, `repost_at`, `reposted_at`,
`captions`). Waiting for the owner's OK; nothing in the app depends on it yet.

## Default effects preset
**What:** One setting that gives every talking video punch-ins, hook push and
spring-in logo, so you don't set effects angle by angle.
**Use it:** Settings → Default effects: Off (as shipped) / Subtle / Strong, or mix
the four controls yourself. Per video: open its row (before approving) →
Effects → "No effects".
**How:** Stored on the phone (`cutter-default-effects`). `videoLook` uses the
angle's own effects if it has any on, otherwise the default, so nothing already
set up changes. Per-video off is `day.noEffects`. Files: `defaultEffects.ts`,
`look.ts`, `pipeline.ts`, `JobRow.tsx`, `SettingsView.tsx`.
**Limit:** Reaction/montage (batch) renderers have no zoom effects at all today
(their code says "effects are not used"), so the default only affects talking
videos. Adding zooms to those is a separate piece of work.

## Edit again (2-hour window)
**What:** After a talking video is made, you can reopen it from Posts and fix
captions, cuts or music without redoing everything.
**Use it:** Posts → the video → "Edit again · 1h 40m left". Fix it, Approve.
**How:** The recording, listen results and edits are kept 2 hours (`madeAt`,
`EDIT_WINDOW_MS`), then deleted. Re-making sends a new post (`id~2`) and rejects
the old one first (also pulls it from Postiz if scheduled). Already posted → the
edit goes out as a new post, and says so.
**Not yet:** reaction/montage/batch/joined videos; excluding one picture.
Files: `store.ts`, `CampaignApp.tsx`, `PostsView.tsx`.

## Wide clips become 9:16 (Meta glasses)
**What:** Landscape (or 3:4) clips are turned into 9:16 automatically.
**Use it:** Settings → Wide clips: Fill (crop, default) / Fit (whole picture over
a blurred copy) / Off. Clips already 9:16 are never touched.
**How:** Size read from the container's display size (rotation applied), 1%
tolerance. Blur is a downscale/upscale (no canvas filter, which some Safari lack).
Fill outputs the biggest 9:16 crop, no upscaling. Files: `framing916.ts`, `render.ts`.

## Outlined headlines
**What:** Headlines default to outline style; outline colour and width are settable.
**How:** `look.ts` Headline.outlineColor/outlineWidth, drawn by `overlay.ts`.

## Pause and daily limits
**What:** Pause a platform or account, or cap posts per day; nothing is lost.
**Use it:** Settings → Posting limits.
**How:** Server `limits.ts`: paused/over-cap posts are marked held (`paused`/`cap`) and
released by the 5-minute tick when free. Files: `postiz/limits.ts`, `PostingLimits.tsx`.

## Account linked later gets existing videos
**What:** Linking a new account attaches it to videos already waiting/scheduled.
**Use it:** Checkbox when saving posting setup (on by default; untick to skip).
**How:** `attach.ts` decides per post: has all / add / add to scheduled / too late /
busy / not open.

## No more duplicate uploads
**What:** The same recording is never kept or posted twice.
**How:** Content fingerprint per file (`fingerprint.ts`); hand posts use a
deterministic key `post-<fp>-<campaign>-<day>`; picking the same file again shows
a "skipped" notice.

## Locked down
**What:** Login first; only the existing login (and a backup admin) get in.
**How:** `LoginGate`, own HMAC token login in the `cutter` edge function, 5 wrong
tries → 30-minute lock, `cutter_*` tables closed to anon/authenticated.
Admin password is the `CUTTER_ADMIN_PASSWORD` secret (not set yet).

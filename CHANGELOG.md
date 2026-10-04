# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

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

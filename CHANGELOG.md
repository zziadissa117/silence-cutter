# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

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
**Repost:** Off unless you turn it on. Campaign, Posting, Repost: "Post each video again
later", after 3 / 7 / 14 / 30 days. When a post is confirmed posted, the scheduler books
its repost; when due, the same video (the copy Postiz already has) becomes a new post
with a caption Claude writes to read differently from the first, then goes through your
usual approval. It is marked "repost" on the Posts screen, linked to the original
(`repost_of`) so the planner bridge never counts it again, and each original is
reposted once. It reuses the same file: a different cut or music needs a re-render,
which only the phone can do.
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

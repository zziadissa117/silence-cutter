# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

## Batch: a number a week, on the days he picks
- His ask (2026-11-14): "I don't want them to be posted every single day ... every Monday, Wednesday, and Thursday.
  Make it so I can choose when those posts are posted ... make it so you can post X times per week and not per day.
  Also, make it so we can choose the days too."
- Batch tab, Posting: "How often" - Every day (Videos a day and More each day, as before) or Days of the week:
  Videos a week, and seven day buttons. Picked days share the week's videos out ("Mon, Wed and Thu - 1 each", "Mon
  2 · Wed 2 · Thu 1"); none picked, they are spread evenly by themselves (3 a week: Mon, Wed, Fri). The other days
  this batch posts nothing - his own videos go out as usual. Going back to Every day keeps the week for next time.
- The batch makes and posts only on those days, each at times spread over the day as before; videos already on a
  day it no longer posts on come out, as when Videos a day is lowered. The status card shows those days as "Off";
  the Start button and the footage line say "3 a week"; Analytics doesn't suggest more a day for it.
- Underneath: `BatchBank.week` (`count`, `days` 0-6, `off`), `batch.weekDays/weekShare/weekdayOf/weekOn/describeWeek`;
  `batchRun.perDayOn` gives each date its share (so making, topping up, trimming and the status follow), `daysToMake`
  passes the days off; BatchView "How often". Tests: `batchWeek.test.ts`, `batchView.test.tsx`.

## Talking heads: talking from the first moment, and the joins tight on edited clips too
- His ask (2026-11-14): "when I start the video, you're not cutting the silence at the very start ... We need the
  very, very start to be cut, just a little bit, to make sure that, between all cuts, it doesn't sound like I'm
  stopping talking. I need to talk the whole time".
- The video now starts 0.05 s before his first word (it kept the hook's start as filmed), faded in over 6 ms.
- A real bug under the earlier join fixes: his voice's start and end were found with his pause setting's minimum
  pause (0.35 s on Balanced). A clip the Cutter edited keeps only 0.15 s before his first word and 0.2 s after his
  last - under that - so on edited clips nothing was found and every join kept about 0.35 s of quiet; only clips
  with a second of quiet at their ends (the tests') were tightened. The edges now count any quiet from 0.06 s.
- Checked in a real render with clips shaped like his edited ones (0.15 s before, 0.2 s after) and a hook with
  0.3 s before his first word: before - first word at 0.33 s, joins 0.40 s and 0.35 s; now - first word at 0.08 s,
  joins about 0.1 s.
- Underneath: `voiceSpan` (`EDGE_QUIET_SEC`), montageRender `OPEN_LEAD_SEC` (the first clip trimmed too, its
  captions from where it starts, faded in). Tests: `voiceSpan.test.ts`.

## Batch: use each clip once (reactions, products, each product step)
- His ask (2026-11-14): "for one of my brands ... they don't want me to repurpose my reaction videos. Sometimes they
  don't want me to repurpose my product videos ... make an option for every single reaction video to be used just
  once ... the same thing for the product ... under each product step, a little checkbox ... If I have 2 videos,
  there are only going to be 2 different variations".
- On each format: a small checkbox under its clips of him ("Use each clip of you once", "Use each hook once" on a
  talking head) and under its products ("Use each product clip once", "Use each video behind you once" on a green
  screen). With product steps, each step card has its own "Use each clip once". All off unless he ticks them.
- Ticked, each of those clips goes in one video only; headlines, songs and the other lists still go round. The
  format makes as many different videos as its shortest ticked list holds (2 reactions ticked: 2 videos), the card
  says how many are left, and when they are used up the batch stops by itself the way it does when every
  combination has been made. A video taken out with Start over gives its clips back; one he Rejects keeps them used.
- Underneath: `BatchFormat.reactionsOnce/productsOnce`, `BatchStep.once`, passed to a format's bank by `formatBank`;
  `batch.pickBatch` never takes a ticked list's clip already in one of that format's videos (read off the made
  combinations - `inVideos`, `stillFree`) and `combos` counts the shortest ticked list (`onceCount`);
  `variationParts` says "(each once)"; BatchView `onceBox` and the step card's box. Tests: `batchOnce.test.ts`,
  `batchView.test.tsx`.

## Talking heads: the next clip starts right after the last word
- His report (2026-11-14, on the videos remade with the change below): "still there's too much separation between
  all clips ... too long before the second one plays ... it better to start next clip after last word".
- The remade videos had the change below (made at 02:26 on the server's 02:18 build) but his step clips were already
  edited, so each join only lost the extra breath: what was left was about 0.16 s of quiet plus the fading end of
  his last word.
- Now a clip ends 0.04 s after his last sound has faded and the next starts 0.03 s before his first - the measured
  edges already hold a word's soft start and fading end. Each join's sound is faded out and in over 6 ms so the cut
  between two takes never clicks. The hook's start and the breath after the very last word are as before.
- Checked in a real render here: the quiet between one clip's last word and the next clip's first is about 0.1 s
  (half-level points), the test video 4.9 s (9.5 s with no trimming).
- Underneath: montageRender `JOIN_TAIL_SEC`, `JOIN_LEAD_SEC`, `JOIN_FADE_SEC` (fade-out before each join in the
  voice, fade-in in `onSound`).

## Talking heads: no long pauses where one clip meets the next
- His report (2026-11-14): "in between clips, there's too much separation ... It feels like there are too many pauses".
- Why: every clip the Cutter edits keeps a breath before the first word (0.15 s) and after the last (0.2 s), so a
  video opens and closes cleanly - two clips back to back left about a third of a second of nothing, twice the pause
  of a cut inside his talking videos. A clip added as filmed (a raw hook, a step never edited) kept all the wait
  before he talked and after he stopped - a second or two at every join.
- Now, in a talking head: every clip after the hook starts just before his first word, and every clip ends just
  after his last - the hook too, so a raw hook's dead air at its end is gone (its start is still exactly as filmed).
  Each join is as tight as a cut in his talking videos (his pause setting's padding). The last clip keeps a breath
  after his last word so the video doesn't end on a clipped syllable. The captions move with each clip.
- Found from each clip's sound the way the Cutter finds pauses, once per clip; a clip whose sound can't be read, or
  with no voice in it, plays as it is.
- Checked in a real render here (Chrome for Testing): a raw hook and two steps, each with 0.8-1 s of quiet before
  and 1-1.2 s after the talking - the pause at each join went from 1.96 s and 1.76 s to 0.14 s, the end from 1.2 s
  after the last word to 0.23 s, the video from 9.5 s to 5.1 s; the hook's start untouched, each step's captions on
  its words.
- Underneath: `voiceSpan.ts` (`voiceSpanOf`, `voiceSpan`), montageRender `joinTight` (parts trimmed, `window` to
  `writeWhole`, step captions from the part's start), `CampaignApp` passes the job's settings, `pipeline.makeMontage`.
  Tests: `voiceSpan.test.ts`.

## Talking heads: the hook as filmed when "Use edits in hooks" is off, and full-phrase captions
- His report (2026-11-14): "when 'Use edits in hooks' is off, why are there still captions in the hook? Why is there
  still music in the hook? ... the raw clip should play. That's it ... once the first product step starts, then the
  music can start. Then there could be maybe some headlines, and then there could be some captions" and "Why is it
  putting one-word captions? I want full-phrase captions."
- "Use edits in hooks" off: the hook plays exactly as he filmed it, with his own sound - no captions, no headline,
  no zoom, no music. The music starts (faded in) with the first product step, the headline (when "Headline on top"
  is on) is over the first product step, and the steps have their captions as before. The format card says so.
  With the switch on, nothing changed.
- Captions on a talking head are full phrases unless he picks another look. Why they were one word: the videos are
  made on his Cutter server, which has no caption settings of its own and fell back to one word at a time. Now the
  format's look is used everywhere, a talking head's is "Phrase" unless he picks One word or Highlight - on the
  format card ("Captions", under the caption height) or on a clip's check - and the size is his Cutter's, sent from
  the phone with the batch.
- The 6 Pump Fun videos waiting in To approve were made before this: Reject them and the batch makes new ones in
  their place.
- Checked in a real render here (Chrome for Testing): with the hook raw, no music under the hook (880 Hz test song
  at 0.000 for the hook's 3 s), the song fading in from the first step; the hook's frame as filmed (no headline,
  no caption, not zoomed); the headline and the whole phrase "go to pump fun and tap create" over the first step.
  With edits on: music, headline, caption and zoom on the hook, as before.
- Underneath: `montageRender` `rawFirst` (`musicFrom`, `headlineOn`, `stepStart`), `pipeline.makeMontage`,
  `CampaignApp` (`rawHook`, the hook not heard), `batch.batchCaptionLook`, `BatchBank.cutterCaptions` (serverLink),
  the format card's Captions row (BatchView), DropCheck's look. Tests: `montage.test.ts`, `batchFormats.test.ts`,
  `batchView.test.tsx`.

## Batch: see where every clip is, and catch the ones in the wrong step
- His ask (2026-11-14): "let's say there was a video that was in the wrong product step. How do I know? If you want
  to make an option to recheck if everything is in the right place".
- On a talking head format's card, under The product: "2 clips may be in the wrong step" (orange) when what he says
  in a clip sounds like another step's name than the one it is in, or "12 clips you haven't checked" for the ones
  put in before the one-by-one check. "Check the 12" goes through them on the same check as dropped clips - the
  wrong-step ones first - each where it is now, marked "Maybe the wrong step" with "Sounds like 3. Tap create coin ·
  Move it" (one tap), any other step to tap, its captions to fix. Approve keeps it there (or where he moved it),
  Take out takes it out of the batch. Once every clip is checked: "Check where every clip is again".
- A clip never heard (never made into a video yet) is heard on the check; the next one is heard while he looks at
  the current one, so he doesn't wait on each.
- "Edit the N clips added as filmed" puts each one back where it was, now marked when its new words say another
  step.
- What it can't see: a clip it heard wrong *and* matched wrong the same way looks fine to it - only looking finds
  that one, which is what "Check the N" is for (once, for the clips from before).
- Also fixed: a clip with no words heard showed no place to pick on the check (and no video) - it shows both now.
- Underneath: `dropQueue.clipsOfFormat` / `soundsElsewhere` / `queueRecheck` / `checkedClip` / `fileIn`, `ToCheck`
  `recheck` / `hint` / `unheard`, `BankFile.checked`; `DropCheck` approves a recheck in place (`placed` keeps its
  spot, a hook moved to a step loses its hook marks); `DropIn` the line and buttons. Tests: `dropQueue.test.ts`,
  `dropCheck.test.tsx`, `dropInView.test.tsx`.

## Posts: To approve on top, days apart, platform logos, and a notification for every post that didn't go out
Needs deploying: run ./deploy-server.sh (posting again by itself, the notification's link, Post it myself / Let the
Cutter post it), then ./deploy.sh.
- His ask (2026-11-13): "The videos that have to be at the top are the videos that are up for approval ... I cannot
  be scrolling and looking for videos for approval ... Then ... today, ... Saturday and Sunday ... make the
  separation more clear"; "Why can't you just put the logos ... It's so much slop"; "I don't like that at the top,
  top, top, it says 'Didn't go out' ... send me a notification ... automatically set it to where it's going to post
  it again by the next available time frame ... do you want to post it yourself now, or do you want the cutter to
  post it back later?"
- To approve: always the first thing on the Posts screen, in its own lit card, every post waiting for him, the one
  going out soonest first, with Approve all in its heading.
- Then a card per day - "Today", "Tomorrow", then the weekday ("Sunday", "Monday") - each with its date and how
  many go out that day. Today and Tomorrow are open; later days are one line each, tapped open. Then Just posted.
- Accounts are shown as the TikTok / Instagram / YouTube / Facebook logos (a small number when there are two
  accounts on one platform; a paused one faded). The usernames are there once a post is opened.
- Didn't go out: no more banner at the top. When a post misses an account, the Cutter sets it to go again by
  itself at the next free time - YouTube's next good hours when only YouTube missed, otherwise the campaign's next
  free time today, otherwise in half an hour - up to 2 times, then it's his. It sits in its day at that time,
  marked "Posting again", showing only the logo it missed. Trial reels and posts that went through Buffer are not
  posted again by themselves.
- Every post that doesn't go out sends a notification ("VAZA didn't go out on @ziad.debates - The Cutter posts it
  again Sat 9:40 AM. Tap to post it yourself instead."). Tapping it opens that post on top of the Posts screen:
  "Post it myself" stops the Cutter posting it and gives Save video and Copy caption; "Let the Cutter post it"
  leaves it (or sets it at the next free time when it wasn't). What didn't go out and won't go again sits folded at
  the bottom, with the same two choices when opened.
- Tests: `postsList.test.ts`, `postsView.test.tsx`, `postsFlow.test.tsx`, `failed.test.ts` (`againAt`, a post
  Postiz lost, named by @username - "Post again" used to say Postiz didn't say which account).
## Edit screen: a clip's Speed
- His pick (2026-11-10, with Split and Delete for the TikTok-like editor) and his go (2026-11-13: "Do editor p3").
- Tap a clip, then Speed: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2× or 3×. The clip gets shorter or longer on the timeline
  (with a "2×" badge on it), the timer shows the new length, it plays at that speed in the editor with his voice at
  its own pitch, and Undo takes it back. Split, trims, a cut put back or cut out all keep the clip's speed.
- The finished video: that part's picture faster or slower (frames dropped when sped up, held when slowed down, so
  the video keeps its frame rate - Instagram takes 23 to 60), his voice stretched to the new length with its pitch
  kept (not a chipmunk, not a growl), and everything timed in it - captions, pictures, the logo, sounds, zooms,
  motion graphics, music length - moved with it. Made the same way on the Cutter server.
- Checked in a real render here (Chrome for Testing): a 12 s recording cut to 0-4 s as filmed, 5-9 s at 2×,
  10-11 s at 0.5× came out exactly 8.0 s, 30 fps; a frame at 5 s shows the recording's 7 s, at 6.5 s its 10.25 s;
  a 220 Hz tone stays 220 Hz in every part with an even level; the captions pop on their words.
- Underneath: `cuts.Part.speed` on the kept part itself (`speedOf`, `partLength`, `keptLength`, `withSpeed`,
  `joinParts` - parts at different speeds never merge; `frameSlots`), every raw-to-finished clock made speed-aware
  (`cuts.outputTime/sourceAt/clipsOf`, `captions.cutTime`, `timeline.MomentPlacer`, `motion/track`), `render.ts`
  (frames through `frameSlots`, a part's sound through `timeStretch.stretch` - WSOLA, no library), CutsEditor's
  Speed tool and `playbackRate` with `preservesPitch`.
- Not tried on an iPhone: Safari keeps the pitch when playing faster (`preservesPitch`), and the render's stretch is
  the app's own. Tests: `speed.test.ts`, `timeStretch.test.ts`, `editorOverlays.test.tsx`.

## Captions in a see-through sheet over the screen, everywhere
- His ask (2026-11-13): "I don't like the sort of caption scrollable feature, with a small screen it's horrible to
  use ... same scrollable but as a sort of overlay on screen. Take half or 75% of the screen, little opacity so we
  see behind it, and we can scroll thru the captions, close it, open it and when its closed i got the full screen
  for like other editing things ... do this everywhere not just in batch".
- Every caption check (Videos, the Batch clip check, Motion graphics, Trial reels) and the timeline editor: the
  phrases are in a sheet over the bottom of the screen, see-through so the video shows behind it, with its own
  scroll. Its grip (the little bar on top) makes it half or three quarters of the screen; the arrow closes it. A
  "Captions · 12 phrases · 2 to check" row opens it again, and in the timeline editor so does the toolbar's
  Captions. While he types it sits right on the keyboard.
- Open or closed and its size are kept: a caption check opens it to start with, the timeline editor starts with it
  closed (the screen is his for the cuts) - after that, as he left it.
- Claude's check of the captions and "Only show the N to check" are at the top of the sheet. Approve, the caption
  style and size stay on the page under it.
- Underneath: `CaptionSheet.tsx` (a portal on the page's body, `useSheetPref`, `visualViewport` for the keyboard),
  `CaptionReview` `sheet` prop, `CutsEditor` `onCaptionsTool`, `EditScreen` keeps it open/closed. The list follows
  the playing phrase only while the sheet is open (it replaced `captionsInView`).
- Looked at on an iPhone-sized screen here (Batch check, timeline editor). Tests: `captionSheet.test.tsx`,
  `editScreen.test.tsx`, `captionRecheck.test.tsx`, `motionView.test.tsx`.

## Talking head batches: every clip cut like the Cutter, checked by him one by one
- His report (2026-11-13), point by point:
  - "remove the leeway, just cut like the cutter is already doing and make sure to use my voice because they have
    been recorded with my mic": the extra room is gone - the cut is his own pacing exactly - and his voices (Settings
    -> Your voice) are used. On the Cutter server they never were: its page has none of his voices. They now go with
    every order, so clips cut there, and his talking videos listened to there, follow his voice on his mic.
  - "You can add some zooms ... exactly like the cutter": each clip gets the zooms his talking videos get (the
    campaign's effects, else Settings' - punch-ins at the cuts, the push-in, a hit when the brand's name is said).
  - "if I add a video in the product steps manually myself, it should get edited too": a talking head step's + Add
    edits the clip the same way. "Edit the N clips added as filmed" edits the ones already in.
  - "Make sure you point out to me every single video and add a way to check with me if that video goes in the right
    place" and "The captions must be editable. And claude must check them EXACTLY like the cutter": no edited clip
    goes in the batch by itself any more. "Check N clips" opens them one by one, full screen: on top, which clip and
    where it goes (the step it was put in lit, "Not sure - check it" when it wasn't sure, any other step a tap away,
    Leave out); under it the Cutter's own caption check - the clip with its captions, Claude reading them by itself,
    every phrase to retype, the caption style and size (kept for the whole format). Approve puts it in the batch
    with its captions; only then do videos use it. Its step learns how he says it.
  - "Make it so we can check 'Use edits in hooks' or not": a switch under Your hook (on to start). On, his hooks are
    edited and checked like the steps' clips; off, they play as filmed.
- The same recording dropped in again is edited again and takes the old clip's place (it was turned away before), so
  the clips cut with the old room can simply be dropped in again.
- Underneath: `prepareDrop` (`dropSettings`: his preset, `voicesHere`, effects; `cutDropped` with `wordMoments`),
  `plan.planCampaignCut` `voices`, `talkOrder` `ListenOrder.voices`/`DropOrder.voices|effects|brandWords`,
  `dropQueue.ts` (the clips waiting for his check, per format), `DropIn.tsx` (the engine; `dropInto` for + Add),
  `DropCheck.tsx`, `BankFile.edited`/`captions` (his checked captions travel with the bank, so the Cutter server's
  videos draw them), `BatchFormat.rawHooks`/`captionStyle`/`captionSize`, `CaptionReview` `top`/`backLabel`.
  The Cutter server rebuilds itself from this push.
- Not run here: the listening (the speech model can't be downloaded in this test setup) and his phone. The check
  screen was looked at on an iPhone-sized screen. Tests: `dropInView.test.tsx`, `dropCheck.test.tsx`,
  `dropQueue.test.ts`, `stepMatch.test.ts`, `batchView.test.tsx`.

## Batch tab: an open format has room again
- His report (2026-11-13): "when I make a talking head batch, I feel like it's so squeezed in together. There's no
  place for anything."
- What was wrong (seen on a phone-sized screen with a Pump Fun-like format): each step's name was squeezed into a thin
  column beside its count and buttons, and its "+ Add" ran off the card; every clip of every step was listed, so one
  format with 29 step clips was about ten phone screens long; the captions height text was cut off.
- Now an open format is in parts, with space and a line between them: **Your hook** (clips of you), **On screen**
  (Headline on top, Captions height - the phone drawing on the right, its text whole - and for green screen your
  voice and corner, in one soft box), **The product** (Edit steps beside its title; Drop in all videos and its hooks
  switch in their own box at the top; then each step as its own card: a number, the name on its own line, how many
  clips and how long, what is on it, then Words & overlays and + Add). Pause and Take out this format at the bottom.
- Clip lists are closed behind one line ("11 clips · 0:46 in all  Show"); Show opens them, with the full names.
- Words & overlays opened inside a step: the phone picture on top and its buttons two by two under it, instead of a
  thin column beside it.
- The card is about half as long (3677 px -> 1622 px on the test screen with every list closed). Nothing about what
  the batch makes changed.
- Checked on an iPhone-sized screen here (talking head, reaction, green screen; nothing wider than the screen).
  Tests: `batchView.test.tsx`.

## Talking heads: no step name over the clips, ever
- His report (2026-11-13, Pump Fun batch): "when I look at words & overlays, there is still text at the top saying
  'Nope, do this instead' ... On my talking heads, I don't want a headline every single time there's a new clip ...
  I only need the captions, and whenever I want, I can put a picture, a video, or text myself."
- Why it was there: the Words & overlays screen started every step with its name at the top, and saving (to add
  an overlay, say) kept that name as his own words. And a talked-over step whose words weren't heard still got its
  name written over it.
- Now, in a talking head format: the Words & overlays screen starts empty (no "Back to its name at the top"); a
  word saved before that is just the step's name is dropped, on that screen and in every video
  (`batch.withoutName`); and no step's name is ever drawn over a clip - only his captions and what he puts there
  himself. Reaction and green screen batches keep their step names as before.
- Nothing of the Pump Fun batch had been posted yet, so no made video needs redoing.
- Tests: `stepTexts.test.tsx`.

## Drop in all videos: done on your Cutter server
- His ask (2026-11-13): "Why are the clips doing on phone and not server tho?" - "yes move it to the server".
- With the Cutter server connected and up, "Drop in all videos" only sends the clips up ("Sending to your server");
  the server listens to them and cuts them, 3 at once, with exactly the same cut as the phone (his pacing plus the
  little more room). Each comes back into the step it says as it is ready, and the same quick check list fills in.
- Once they are all sent he can close the app: the phone remembers what is still on the server and sorts it in the
  next time the format's drop-in is on screen ("Your server is cutting 12 more clips").
- The cut clips stay on the server for the batches it makes, and a copy comes down to the phone too.
- No server, or the server not taking a clip: that clip and the rest are done on the phone, as before.
- Underneath: talk order kind `drop` (`talkOrder.DropOrder`/`DropResult`, `serverTalk.runDrop`, shared
  `prepareDrop.cutDropped`); server `server/main.mjs`: `PUT /talk/:id` takes `drop`, new `GET /files/:id` (his
  login, his space only) and `PUT /local/files/:id` (the page keeping a file it made, 127.0.0.1 only); step overlay
  files now count as used (not let go of after two days). The Cutter server rebuilds itself from this push.
- Checked here: the server's new routes run for real (order, keeping the cut clip, reading it back byte for byte,
  401 without his login, 404 for anything else). Not run here: the listening on the server (the speech model can't
  be downloaded in this test setup) and the phone. Tests: `dropInView.test.tsx`.

## Drop in all videos: hooks too, his pick per format
- His answer (2026-11-13): "Make it so I choose each new format, it's fine."
- A talking head format has a "Dropped clips can be hooks" switch (off as before). On: a dropped clip that says no
  step's name becomes one of the format's hooks (cut and captioned the same way); the check list has "Hook" in its
  dropdown, and a clip that says next to nothing of any step counts as a sure hook.
- A recording dropped in before is not kept again ("already in from before" on the check).
- Tests: `dropInView.test.tsx`, `stepMatch.test.ts`.

## Talking head formats: drop in all your clips at once
- His ask (2026-11-13): 45 short clips of him saying each step's phrase - "Drop in all videos ... the cutter cuts the
  videos and cuts the awkward silences ... puts captions ... assigns them to the product steps. After those get
  done, I verify really quickly." His picks: matched by the step's name; cut "exactly like the cutter is cutting
  now, but with a little bit more leeway".
- A talking head format whose product steps are set has "Drop in all videos" (under its steps). Pick them all; each
  one in turn is listened to, cut with his own pacing plus a little more room (a pause must be 0.2 s longer to be
  cut, 0.06 s more kept around each word), kept as a step clip with its captions' words (never listened to again),
  and put in the step whose name he says in it ("Step 1: Nope, do this instead" -> the clips where he says "nope,
  do this instead").
- Then one quick list: what he says in each clip and its step, the ones it isn't sure of first (marked), a dropdown
  to move one or "Leave out". "Looks good" finishes; each step remembers how he said it, so the next drop-in sorts
  his wording better. A clip it couldn't use says why. "Stop after this one" stops a long drop-in.
- Product steps only for now; sorting hooks the same way is proposed to him first.
- Not run on a phone here: the listening can't run in this test setup. Tests: `stepMatch.test.ts`,
  `dropInView.test.tsx`.

## Talking head formats: captions at any height
- His ask (2026-11-13): "let me change the captions' height ... at the top, at the bottom, or at the middle. Let me
  change it manually and not in a set space" - once per format.
- A talking head's format card has a small phone screen: drag the captions up or down (near the middle they snap to
  it and a line shows). Every video of that format puts its captions there - the talking part and the steps he
  talks over. "Back to the usual place" undoes it. Kept with the format, so the Cutter server's videos have it too.
- Tests: `captionHeight.test.ts`, `batchView.test.tsx`.

## Product steps: pictures and videos on them, and a line to centre things
- His ask (2026-11-13): "make it so I can add an overlay too, not only text ... a video or a picture from the video
  bank, from whatever. Make sure that, for the text, there's a little line to center it."
- A step's "Words & overlays" button (was "Words") opens its phone screen as before, with two more buttons:
  "+ Picture or video" (from his phone) and "+ From your banks" (the video bank and the picture bank). Each is kept
  with the batch's clips (sent to the Cutter server with them), lands in the middle, can be dragged anywhere and made
  bigger or smaller, or taken out.
- In every video of that format, each pops in as the step comes on: a picture stays for the whole step, a video plays
  muted to its end then goes. They sit under the step's words and captions (`stepOverlays.ts`, montageRender
  `stepOverlays`).
- Dragging words or a picture near the middle snaps it to the exact middle and shows a yellow line (across and/or up
  and down), so he knows it is centred.
- Checked with a real batch render in Chrome (a picture and a video on a step) and the screen in a browser.
- Tests: `stepTexts.test.tsx`.

## Product steps open where he taps them
- His report (2026-11-13): tapping "Product steps" in a format put the steps editor "on top of me" - it opened at
  the top of the Batch tab, above everything, far from the button.
- Now it opens inside that format's card, right under the button. In a talking head it also says a step he talks
  over shows his captions instead of its name.
- Tests: `batchView.test.tsx`.

## Batch formats: headline on top, or not
- His ask (2026-11-13): the clip of him can be the hook by itself (a horizontal clip with its own words) - "make it
  so I can choose if I want one or not".
- Each format card (Batch tab) has a "Headline on top" switch, on as before. Off: no words over the clip of him -
  no headline and no Claude + X - and the format's videos are mixed from his clips, products and songs alone. It
  reaches videos already planned but not made yet. A talking head keeps its captions either way. The card says
  "no headline" when it is off.
- Tests: `batchFormats.test.ts`.

## Talking head batches: one kind of words per clip
- His point (2026-11-13): "a headline on top and then always a caption in every single clip. Does not make sense."
- Now, in a talking head batch: his talking clip has the headline (the hook) and his captions, as before; a product
  step he talks over shows his captions only - its name is no longer put on top of them; a step he doesn't talk in
  shows its name, as before. Words he placed himself on a step (the step words screen) still show.

## Wide clips untouched everywhere, black not blurred, captions on product steps
- His answer (2026-11-13): "do it for talking video batches too. Black is good ... The video is going to be in 9:16,
  but it's going to have a horizontal, already premade thing. Just don't change anything about the video itself ...
  I want the black background behind me, not blurred." And: should he type a talking head's step captions as the
  step's name?
- Talking videos: a wide clip is now shown whole on black (Settings "Fit", now the default; it used to be over a
  blurred copy of itself, and the default was Fill, which cropped it). A phone that had Fill saved is moved to Fit
  once; picking Fill again in Settings still works.
- A clip already made 9:16 with black bands in it (a wide video put in 9:16 beforehand) is told from its picture and
  left exactly as it is - no push-in, no zoom at the cuts, which would crop it (`blackBands.ts`), in talking videos
  and in batches. A wide clip in a batch is no longer zoomed inside its band either.
- Talking head batches: the product steps he talks over get captions of what he says, heard once per clip like the
  talking clip (kept for every video after) - no need to type captions as the step's name; the name stays a short
  title at the top.
- Checked with a real batch render in Chrome: a ready-made 9:16 clip with bands under strong zooms (unchanged), a
  wide clip (whole), a talked-over step (its name and its captions).
- Tests: `blackBands.test.ts`, `framing916.test.ts`.

## Batches: a wide clip stays wide
- His ask (2026-11-13): some batch clips - his reaction at the start, or a clip before or after - are horizontal;
  "it keeps being horizontal, and that's it. It doesn't convert it to fill it in."
- Before: every clip in a batch video was cropped to fill the upright frame - a horizontal clip lost its sides.
  (The Fill / Fit / Off setting in Settings is for talking videos only; it never reached batches.)
- Now, by itself, clip by clip: a wide clip (landscape, square, 3:4) is shown whole across the middle on black,
  nothing cut off; a clip filmed on a phone held upright fills the screen as before. The headline sits on the black
  above it. The slow push-in and the zooms happen inside the clip's band, which stays put.
- The step words screen (where he places each step's words) shows a wide step clip whole too, as it will be made.
- Checked with a real batch render in Chrome: a 16:9 reaction then an upright product clip.
- Tests: `montage.test.ts`.

## Edit again: always there until the video goes out
- His report (2026-11-13): "why in the world did you remove the edit-again feature? ... I need to have the option
  for that at all times." It wasn't taken out, but it was gone when he needed it, for two reasons:
  - A talking video made on the Cutter server (3 or more waiting) had its recording and edits thrown off the phone
    the moment the server finished it - so it could never be edited again. His Money pilot videos of 2026-11-13
    were made there.
  - On the phone, a video's recording was only kept 2 hours after it was made; a post waiting longer for approval
    lost its Edit again.
- Now:
  - A video made on the server is kept on the phone like one made on the phone.
  - A video can be edited again for as long as its post hasn't gone out - waiting for approval, approved, scheduled
    ahead - and 2 hours after it is made, as before (at most 14 days, for the phone's space).
  - On a post waiting for approval, "Edit again" sits beside Watch and Reject, not under More options.
- The videos made on the server before this update can't be opened again: their recordings were already let go.
- Tests: `editAgain.test.ts`, `postsView.test.tsx`.

## Steadying: only when it helps, and no more long waits
- His report (2026-11-13): "the stabilization ... took me 2 whole minutes ... is it even worth it?" His reports
  showed why: his 68 s selfie take sat about 2 min 20 s in "Steadying" and was then thrown away as not steadier -
  like 16 of his last 27 takes. Every take went through three passes over all its frames (measure, make again,
  measure again), even when it was steady.
- Now:
  - Front camera takes are never steadied: talking to the camera they measured 1 to 2 px of movement a frame,
    nothing to take out. Only the back camera's takes are (what he asked it for).
  - A take with little shake (under 0.3% of the width a frame) is left as it is after the quick measuring.
  - Before making it again, the Cutter works out how steady it would come out; when that isn't clearly steadier,
    it isn't made again for nothing.
  - The "is it really steadier" check is made on the frames as they are made - no third pass.
  - Skip stops it at once (before, it finished the clip it was on first).
- Checked in Chrome on test clips: a steady 10 s clip is left alone after the measuring; a shaky one comes out with
  half the shake; Skip on a 30 s clip stops within a moment.
- Tests: `stabilize.test.ts`.

## Motion graphics: Play before making, and cleaner graphics
Needs deploying: run ./deploy-server.sh (Claude's motion prompt, the new compare card), then ./deploy.sh.
- His ask (2026-11-12): "put more effort overall with motion graphics, it's obviously v1 right now and it's lazy
  and sloppy, a lot of things are missing". Every look was drawn frame by frame here and what was wrong fixed.
- Play: on the plan screen, tap the video (or Play in its corner) and it plays as it will be made - his voice, the
  cuts skipped, the graphics moving, the captions - before anything is made. Tap again to stop; the slider stays
  where it stopped. Before, he could only slide through still pictures. (The button sits in the corner: in the
  middle it covered the caption.)
- Change a graphic yourself: tap any moment on the plan and its words open under it, each in its own box (the
  title, each card's lines, the sum and its result, each step...). What you type is on the plan at once - the
  picture and the list follow - no asking Claude and waiting for a typo. "Take this out" removes the moment, with
  "Put it back" in case. The call to action can be reworded but stays (always one). A graphic's main words can't be
  emptied by mistake. Claude sees your changes the next time you ask it something (`motion/editPlan.ts`).
- Glass look: one graphic at a time. The title, each card, the steps screen and the call to action now take turns
  (`glass.glassSlots`): a card no longer comes up while the steps screen is leaving, nor the call to action over
  the last card. Small words (labels, tags, notes, the stat's line) are bigger - some were about 8 pt on a phone;
  the stat's bars no longer cover its line; the steps rows are bigger.
- Board look: comes up with its first graphic (no empty board for a second), the graphics sit centred and slide up
  as each new one arrives, and the board keeps showing the last scene while it stays up for the next. The hook
  card and the call to action are big; the call to action is a card with its drawing and a pulse. While the board
  is up, the caption sits on the line above his face instead of over it.
- The made video uses the plan's own timing for these turns, so it matches what Play and the stills show.
- The shot moves, in both looks (`motion/camera.ts`): a slow push-in on his face as the video opens, a little closer
  or back out at some cuts, and a quick punch-in as a big moment lands - a card over his face, a number, the call to
  action (at most 6, at least 5 s apart, never while the board covers his face). The board look's picture never
  moved before; the glass look only at cuts. Play and the stills show the same moves.
- Board look: a graphic arriving no longer lands on the one above it while that one is still sliding up - it rides
  in under it - and nothing on the board ever hangs over his face.
- Glass look: a new card for a contrast - "most people: 1 video a week" crossed out, then "me: 25 a day" sliding
  in ticked on the word he says it, "vs" between. Claude uses it when he contrasts them and him, before and after.
  It has its sounds, its punch-in and its boxes on the plan screen like the others.
- "Another plan" next to the look: Claude makes a different take of the plan (other moments, other graphics, same
  look) in one tap - no need to type what's wrong when you just want something else.
- Tests: `motion.test.ts`, `motionView.test.tsx`.

Needs deploying: run ./deploy-server.sh (the caption check's French rules), then ./deploy.sh.
- His report (2026-11-12): "the french is detecting really bad". The reports show the language was told right (his
  French test: fr 0.994; another phone's English video: en 0.858, and it was English) - it was the French words that
  came out badly: they were heard by Whisper's tiny model, the weakest at French.
- French is now heard by Whisper "small" - about half tiny's mistakes in French by Whisper's own measures. About
  250 MB, downloaded once, the first time a French video is heard. English is unchanged (tiny.en), and the language
  is still told by the tiny model, which does that well.
- A phone that can't hold it steps down by itself, and remembers: out of memory while listening -> "base" at once;
  the page dying while French was being heard -> the next one down from then on (`transcribe.frenchStep`). Closing
  the app or switching away mid-listen doesn't count.
- Claude's caption check is told French needs more fixing (sound-alike words, wrong endings, split words), and to keep
  Québec French and its English words as he says them.
- Each French video reports which model heard it and its first words, to judge the next fix by.
- Tests: `french.test.ts`.

## Motion graphics: the call to action fits the video, in a place of its own
Needs deploying: run ./deploy-server.sh (Claude's motion prompt), then ./deploy.sh.
- His ask (2026-11-12): "CTA does not always have to be comment UGC at the same exact place".
- The words: his own when he says one; otherwise Claude writes one that fits the video, 2 to 5 words, in his
  language, not the same one every video ('Comment "UGC"' only when the video is about UGC; 'Save this for later',
  'Send this to a friend', 'Follow for part 2'...), never promising what the video doesn't (a link, a guide).
- The place: each video gets its own - over his head or in the middle in the glass look (still nothing below his
  face), at the top, in the middle or low in the board look. When he asks Claude to put it somewhere, it goes there.
- Its icon fits it: a speech bubble for a comment, a star for a save, a person or heart for a follow, an arrow for
  a share (was always the speech bubble).
- Tests: `motion.test.ts`.

## French videos: told by themselves, heard in French, captioned in French
Needs deploying: run ./deploy-server.sh (the caption and caption-check prompts), then ./deploy.sh.
- His ask (2026-11-12): his friend makes French videos; captions and motion graphics have to work in French, with
  nothing to choose - "it just automatically sets those".
- Before: the Cutter listened with an English-only model (whisper-tiny.en), so French came out as nonsense.
- Now each video's language is told first: up to 30 s of the talking goes to the multilingual model (whisper-tiny,
  the same size), which says which language comes next - French only when it is clearly surer of French than of
  English; anything unclear stays English, exactly as before (`media/speechLanguage.ts`, `transcribe.detectLanguage`).
  It runs in a worker of its own that is ended at once, so the phone's memory is as before.
- A French video is heard by the multilingual model, told "French, write it down" (never translate). The English
  letter model that times words exactly is skipped for French (it only knows English letters); captions use the
  speech model's own times, and word endings are protected from them.
- French captions: a "?" or "!" written after a space stays with its word, and the subtitle credits Whisper makes up
  over silence ("Sous-titres réalisés par la communauté d'Amara.org") are dropped. "Euh" is cut like "um" (not
  "bah", "ben" or "hein"). A take with only those credits is a reaction (no talking).
- Claude keeps the language: the post caption and title are written in the language of the video (unless the
  campaign's rules say otherwise), and the caption check fixes French as French. Motion graphics and headlines
  already wrote in the language he speaks.
- Settings -> Your voice: the paragraph to read is in French on a phone set to French, with "Lire en français" /
  "Read it in English" to switch.
- Each video sends a `check` report "language: fr (en 0.02, fr 0.97)" to see what was told.
- The first time, the multilingual model downloads once (about 40 MB), on every phone - it also tells English.
- Tests: `french.test.ts`.

## Edit screen: overlays dragged straight away, the playhead stays put
App only: run ./deploy.sh.
- His asks (2026-11-12): adjust an overlay by its length, not only its time; no "on screen for", no size, no
  "Start it here" or "Put back" - just slide it or pull its arrows; bigger when put on; and tapping it must not
  move the playhead ("I lose track of where I was"), nor should he have to tap it before dragging.
- A finger on any bar in the timeline (picture, video, words, sound) moves it at once - no tap first. Near either
  end it stretches it instead: longer or shorter, or starting earlier or later. The picked one shows white arrows
  at both ends, like a clip's.
- A tap on a bar only picks it: the playhead stays where he left it (it used to jump to the bar's start).
- The panel under the timeline keeps only what has no other way: the words and their look for text, the volume
  for a sound, Delete. The seconds stepper, the size slider, "Start it here" and "Put back" are gone - size is a
  pinch on the video, place a drag.
- A picture put on comes in at 60% of the width, in the middle, easy to see and grab (was 40% in a corner).
- Bars a little taller (28 px) for a thumb.
- Tests: `cutsPictures.test.tsx` (tap keeps the playhead, drag the end, drag the middle, no tap first).

## Reactions are music only; Posts by what goes out next; Settings, Batch and the edit screen redone
App only: run ./deploy.sh. (The Cutter server rebuilds by itself from this push and makes reactions music-only too.)
- Reactions (his ask: "I just film ... automatically it knows I'm doing a reaction. The music should take up 100% of
  everything. It should mute the clip and just do the music ... at a normal volume"):
  - A video with no talking was already found by itself and kept whole with no captions. Its music sat under the
    clip's own sound, set from how loud the clip was - over a quiet room the song came out barely there.
  - Now its own sound is muted and the song is the only sound: set to -14 LUFS, up or down (the level batch songs
    play at), starting again if it is shorter than the video, never dipped (`render.ts` `musicOnly`).
  - No song picked and none on its campaign: one from the music bank, the same one for the same video.
  - Its row says "Reaction, no talking · music only"; the edit screen plays it muted, as it will be.
  - On the phone and on the Cutter server alike (`MakeOrder.musicOnly`).
- Posts (his ask: "It needs to be ordered: what's the next thing that's going to post? At the bottom, things that
  have been posted, but only in the past couple hours"):
  - Up next: everything still to go out - to approve, approved, scheduled - in one list by its time, day by day, the
    next one first. Each row starts with its time and has a chip for where it stands (To approve, Scheduled, Tap
    Post). The first 15, then Show all.
  - Didn't go out: failed posts, or ones that missed an account, from the last day - at the top, with Post again.
  - Just posted: the last 3 hours, newest first. Older ones are on Analytics.
  - Batches aren't folded into one row any more: Approve all at the top approves everything waiting, the first 3 of
    a new batch open with their video, and a batch's captions are redone from any of its posts.
- Settings: a card at the top with who is signed in and whether it's shared, then groups - Posting, Your voice,
  Cutting, Captions, Effects, Server, People, Appearance, Space - each under its own coloured mark with its rows in
  one card. Space shows a bar of what the app keeps. Every setting is the same as before.
- Batch, same layout: the campaign as a card with its badge and accounts (tap it to pick another), a coloured mark
  on each part, format cards with a coloured edge by kind, Videos a day as a big number.
- Edit screen: the app's purple instead of TikTok's red, the video lit from behind with a big glass play button
  that goes away while it plays, the time as a pill and a white play button, the timeline on its own panel with a
  knob on the playhead and coloured lanes, the tools as icon tiles.
- Tests: `reactionSound.test.ts` (level, loop, song pick), `postsList.test.ts` (the order), Posts screen tests
  rewritten for the one list.

## The new look, step 2: the screens themselves
App only: run ./deploy.sh.
- His word on step 1: "that was lazy ... inspiration, not a 1:1 copy ... it does not have a premium feel, and you
  didn't change much". This time each screen was rebuilt and checked on screenshots of the real app, dark and light.
- Videos tab (`HomeTop.tsx`):
  - a header with his initial, a greeting and whether his work is shared (tap -> Settings);
  - "Today": one big number of videos going out today, then pills for out / scheduled / to approve / failed
    (tap -> Posts);
  - Record and Add videos as two big tiles side by side;
  - his campaigns as a row of brand badges (logo, or the first letter on a colour of its own) -> Campaigns.
- Analytics (`Overview.tsx`): the last 7 days' views as a big number with a bar for each day's videos out, then the
  week's videos by where they stand (posted, scheduled, to approve, failed) and the share that went out. From the
  posts list the phone already has - no new request to the server.
- Posts: the time as a pill, views of what went out as a pill on each row.
- More: each row with an icon on its own colour, one short line under each.
- Campaigns: each campaign's letter on its own colour, the same as on the Videos tab.
- Batch: the long explanations under each part are now tips (Settings -> Show tips) - the screen is a third shorter.
- Cards with a soft light from the top corner, a glow behind the top of each tab, big numbers in a light gradient.
- Tests: `homeCounts.test.ts` (today's counts, the week's counts, a name's colour).

## The new look, step 1: dark, rounded, purple, a floating tab bar
App only: run ./deploy.sh.
- His ask: make the Cutter look like the apps in his screenshots ("the cutter just looks like an old app").
- Everywhere at once (index.css tokens + the last block of campaign.css):
  - pure black behind, soft dark cards (#121214) with big rounded corners (24) and a hairline edge;
  - one purple (#8b7cf6) for what to do next - the main button glows a little;
  - pill buttons and chips, the chosen one lit purple with an outline;
  - bigger, bolder titles (38, extra bold) and section titles (21, bold);
  - the tab bar is a floating pill of icons, the tab you're on in a purple pill (names still read out to VoiceOver).
- Dark is now the look by default; Light is still in Settings -> Appearance ("Automatic" became "Dark").
- Light keeps the same shapes with a darker purple. The TikTok edit screen keeps its own black and red.
- Design guidance from the ui-ux-pro-max skill he linked (touch targets, contrast, no emoji icons, reduced motion);
  the look itself from his screenshots.
- Next: the screens themselves (Videos home with a header and the day's numbers, Analytics cards).

## Your voice: a paragraph made to cover every part of talking, and a voice per mic
App only: run ./deploy.sh.
- His ask: "a specific paragraph ... to know exactly how to hit every single area of our speech", and "sometimes I
  would have to record without a mic, but I'll just override".
- The voice setup's reading is now five short lines, shown one under the other with "pause" where to stop a second:
  soft starts and soft ends (honestly, five, thirty; fast, it, shifts), a quick list, a question, numbers, short pauses
  at the commas and long ones between lines, and a last word that trails off (`VoiceSetup.READ_LINES`).
- **Several voices, one per mic:** each setup is saved under its mic ("Phone mic", or your mic's name); setting up on
  a mic you already have replaces that one, another mic is added (up to 4). Each video is cut with the voice it
  sounds most like - automatically - or with the one you pin in Settings -> Speech -> Your voice (Automatic / each
  voice, each with "take out", "+ Voice" for another). A pinned voice is used whatever the video sounds like.
- The Videos tab reminder now says when your videos sound like none of your voices: add one, or pin one.
- Underneath: `voiceProfile` `loadProfiles`, `addProfile`, `removeProfile`, `chosenVoice`/`chooseVoice`,
  `pickProfile`; `withProfile` takes the list and the pin. Old single voices carry over. Tests: `voiceProfile.test.ts`.

## Your voice, and "um"s found by their sound
App only: run ./deploy.sh.
- His ask: teach the cutter how each person talks so it cuts silences perfectly; and "in each video, when it notices
  an 'um' ... try to fix it ... and point it out to me in the captions."
- **Your voice (Settings -> Speech -> Your voice, and a reminder on the Videos tab until it's done):** about 45
  seconds on the mic you film with - 3 s of quiet, a paragraph read the way you talk, a few "um"s, a breath. From it
  (`voiceProfile.ts`): your room on that mic, your voice, how low your word endings go, your natural gap between
  words, your "um". Every talking video is then cut with the silence line under your word endings (never above the
  one you set, never 15 dB under it) and no pause shorter than your natural gap. A video that sounds clearly
  different (another mic or phone) is cut without it, and after two in a row the Videos tab asks you to record it
  again. Kept on this phone (talking videos made on the Cutter server don't use it yet).
- **"Um"s by their sound (`umFind.ts`), every talking video:** the speech model leaves "um"s out of what it writes -
  why cutting them never worked. Now, with every word timed exactly, your voice held steadily between two words with
  no word on it is an "um"/"uh"; each one is heard a second time on its own, and if a real word is heard there it
  stays. The rest are cut, never into the words either side, and listed: in the captions ('"Um"s cut', each to
  listen to and Put back) and in the edit screen's "Check these". Needs the exact word timing; videos without it
  ("rough times") are left as they were. A report line per video says how many were found, cut and kept.
- The old Settings switch is renamed "Also cut stumbles and the "um"s it hears in words (old way)" - best left off.
- Tests: `voiceProfile.test.ts`, `umFind.test.ts`. The voice setup was run in a browser with a fake mic: it records,
  measures and saves. Not tried on an iPhone or on his real recordings.

## Green screen steps get your own words too
App only: run ./deploy.sh.
- His ask: the Words on a phone screen, for green screen product steps too. Batch tab -> a green screen format -> each
  step -> **Words**: the same editor; every video draws a step's words while that step's clip plays behind him, in
  front of him, exactly where you put them.
- A green screen step without words of its own still has none (as before - its name is not written on it).
- Underneath: `greenScreenRender` `stepTexts` (per background clip, laid out once, drawn while it plays), passed by
  CampaignApp from `BatchStep.texts`; the step's hint no longer says its name is written over it.

## Product steps: your own words, anywhere on the clip
App only: run ./deploy.sh.
- His ask: "an example of a phone screen ... click on the phone screen and put, let's say, a text on top and a text
  at the bottom ... really personalize the way text is put on those product tabs."
- Batch tab -> a format's product step -> **Words**: a phone screen with the step's own clip playing. Tap anywhere to
  put words there (or "+ Text at the top" / "+ Text at the bottom"), type them, drag them, make them bigger or
  smaller, pick Outline / White box / Snapchat - as many as you like. Save: every video's clip of that step gets
  exactly those words, there. "Back to its name at the top" undoes it.
- The preview is drawn with the videos' own text code and the campaign's headline look, so what you see is what is
  made. Videos not made yet take the step's words as they are when made.
- A step never opened in Words keeps its name at the top, as before. Green screen steps have no words (as before).
- Underneath: `BatchStep.texts` (`StepText`), `batch.stepTexts`, `StepTexts.tsx`, `montageRender` `stepTexts`
  (CampaignApp passes them per clip); Set order keeps a step's words. Tests: `stepTexts.test.tsx`.

## Fields you can see
App only: run ./deploy.sh.
- His report: on the new warm-up idea form "I don't even see any outlines ... I wouldn't know that this is a text
  area." In light mode a field was filled with the same grey as the page around it, with no border - invisible
  anywhere a form sits straight on the page (warm-up ideas, filming a warm-up, motion graphics, and others).
- Now a field straight on the page is a white box with a thin outline (dark mode: a dark box with an outline); a
  field on a white card keeps its grey fill, as before. Tapped, its outline turns blue with a soft glow. The - and +
  of a stepper (a warm-up's length) are real buttons now, not bare signs. All in `campaign.css`, so every screen.

## Warm-ups: an account forgotten for a day gets one
App only: run ./deploy.sh.
- His ask: "whenever there's a day I maybe sometimes forget to post on certain campaigns ... a warm-up video ... so it
  keeps my account warm."
- Every account of every posting campaign (not Trial reels), checked when the app opens and every half hour while
  it is open: nothing posted on it for 24 hours and nothing going out on it in the next 12 -> one of his filmed
  warm-ups goes to THAT account only (the best one that campaign hasn't had the idea of), at its next best hour,
  on top of everything else. Like every warm-up it waits for his OK in Posts, with a notification. At most one per
  account per quiet day; paused accounts are left alone; an account new to the Cutter waits a day first (so nothing
  fires in the first 24 h after this update). Works whether or not warm-ups are turned on for that campaign.
- Needs warm-ups filmed (More -> Warm-ups) and the app opened now and then - the videos are on the phone.
- Underneath: `warmupPlan.quietAccounts`, `warmupSend` (after the weekly plan; `warmups:seen`, `warmups:quiet` on the
  phone), `sendExtraWarmup` with `only`. Tests: `warmupPlan.test.ts`.

## Trial reels: copies of different lengths
App only: run ./deploy.sh.
- His ask: "mostly keep it at 8, but sometimes make it 7 or 6" - Instagram takes the copies for the same video.
- Each new copy of a viral reel is now its whole length 60% of the time, 1 second shorter 25%, 2 seconds shorter 15%
  - the end taken off, its sound fading out as usual; never more than a quarter of a short clip
  (`trialLoop.trimFor`, `TrialLook.trimSec`, `montageRender` `shorterBy`). Phone and Cutter server alike.
- A talking clip's copies are never shortened: that would cut his last words (they already differ by headline,
  song and light).
- Copies already made keep their length; use "Make again" in Trial reels to remake the ones not out yet.
- Tests: `trialLoop.test.ts` (copies of different lengths).

## Every video its own cover on the profile grid
Server: run ./deploy.sh (it runs ./deploy-server.sh).
Needs deploying: run ./deploy-server.sh
- His ask: "make it so every cover is different by making it a different timestamp per video" - MediaBoxing's CEO
  doesn't like a grid where the videos look the same. Instagram used the first frame for every cover.
- Now every video, on every account, goes to Postiz with its own cover moment (`thumbnailTimestamp`, which Postiz's
  Instagram code sends as `thumb_offset`): somewhere between 12% and 88% of the video, never the first frame or the
  very end, different for every video and every account, and the same if the same video is sent again
  (`postiz/cover.ts` `coverMs`, worked out from the post's and the account's ids). Batch, talking, by hand, Trial
  reels, accounts added later, reconnected accounts - everything that goes through Postiz.
- Videos already handed to Postiz keep the first frame; those that go via Buffer too (Buffer takes no cover moment).
- Tests: `postiz/cover.test.ts`.

## Cutting: the end of every word is kept
App only: run ./deploy.sh.
- His report: "it just cut off the end of my words." Since 2026-11-10 the loudness is measured in exact 20 ms steps
  and a pause exactly the minimum length counts - both right, but together the pauses came out a little longer and
  began a little earlier, eating the quiet last sound of a word ("s", "t", a breath out). The Cutter only ever kept
  each word's START (the speech model's ends are too rough to trust).
- Now, when the letter model has timed his words exactly (most videos - the report says "exact times"), a cut never
  starts before a word has finished: every kept part runs on to at least 80 ms past the end of the last word in it
  (`plan.keepWordEnds`, `WORD_TAIL_SEC`) - never into the next part (they join) and never into an "um" or stumble
  being cut. A word cut on purpose stays cut. Talking videos on the phone and on the Cutter server both.
- Not changed: the plain "Cut only" page; videos whose words couldn't be timed exactly ("rough times").
- Tests: `plan.test.ts` (the end of every word is kept).

## Motion graphics, Format 2: every card above your face, over your forehead
App and server: run ./deploy.sh (it runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
- His strict rule: a glass card is ALWAYS above his face, over his forehead, at the top of the middle square - never
  under his face, never beside his head, never behind him. The drawing puts every card there whatever the plan says
  (plans made before included), Claude is told so, and its answer is made to say so (`postiz/motion.ts`
  `ABOVE_FACE`); asked for a card somewhere else, Claude says it stays above his face.
- He is never cut out any more (`glass.behindAt` is always false): no card goes behind him - quicker to make too.
- The plan screen says "above your face" for each card.

## Motion graphics: Make sends the change you typed first
App only: run ./deploy.sh.
- Typed a change for Claude and tapped Make without tapping Send? The button now says **"Send my change, then make
  the video"**: it sends your change, waits for the new plan, and makes the video from that - never from the old
  plan. While a change is being sent the button says "Sending your change…" and can't be tapped twice. If Claude
  can't make the change, it says why and nothing is made.
- Underneath: the typed text lives on the plan screen (`MotionView.PlanScreen` `draft`/`send`), `make(given)` makes
  from the plan Claude just sent back. Test: `motionView.test.tsx`.

## Trial reels: talking videos - one clip, many copies, a new headline and song each
App and server: run ./deploy.sh (it runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
- More -> Trial reels -> **Talking - my own video** (next to **Not talking - a viral reel**, which works as before).
  Pick the talking video that did well, as you filmed it, and tick its songs from your music bank, then Start:
  1. it listens once (pauses and "um"s found, every word);
  2. you check the captions once - Claude reads them first, as on every talking video - and Approve;
  3. Claude writes 20 headlines from what you say, in the style of your best past ones; take out the ones you don't
     like, add your own, or Write more; Start.
- The clip is cut **once**; every copy says the same words with the same captions, its own headline (each in turn,
  every one used before any again) and one of your songs under your voice (every song once a round, a new order each
  round, never the same song twice in a row), a touch brighter or darker. Same loop as the viral reels: so many a
  day, Trial Reels to people who don't follow you, the first 3 waiting for your OK, Stop on it takes its copies out.
- Start with nothing picked now says so ("Pick the viral reel and its clean clip first." / "Pick your talking video
  first.") instead of a grey button.
- Underneath: `trialLoop.TrialTalk` (`words`, `headlines`, `songs`; `songFor`, `talkRead`), `trialTalk.ts` (hear,
  captions onto the cut, cut once), `TrialTalkStart.tsx`; the copies are batch videos with his voice kept
  (`voice`) and the captions drawn by `montageRender` (CampaignApp, `trialTalk`). Server: action `trial-headlines`
  (`postiz/trialHeadlines.ts`), for logins allowed Trial reels only. No database change.
- Not yet: 1-2 motion graphics per copy (in the backlog).
- Tests: `trialLoop.test.ts` (a talking clip), `trialView.test.tsx`, `postiz/trialHeadlines.test.ts`.

## Warm-ups, step 4: an extra warm-up when an account goes cold - your yes first
App and server: run ./deploy.sh (it runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
- When an account's videos stop getting views (the "Accounts that stopped getting views" card), it now asks
  **"Post an extra warm-up on it?" Yes / No** - on that card in Analytics, and under "Accounts gone cold" in
  Warm-ups. Nothing goes out without your Yes.
- Yes: the best of your filmed warm-ups that campaign hasn't had the idea of (its own categories first, any if none)
  goes at the account's next best hour, at least 3 hours away, on **that account only** - and still waits for your
  OK in Posts, with its notification. No: not asked again for a week; asked again then if it is still cold.
- None filmed that can go there: it says so (film a few in Warm-ups).
- Underneath: `warmupPlan.planExtra`, `warmupSend.sendExtraWarmup`, `ColdWarmup.tsx`; the server keeps such a post to
  its one account (`meta.warmup.only` -> `rules.only`, read where the scheduler picks accounts; adding an account to
  the campaign doesn't add it to that post). No database change.
- Tests: `warmupPlan.test.ts` (extra warm-up), `batch.test.ts` (only that account).

## Warm-ups, step 3: posting them per campaign
App and server: run ./deploy.sh (it runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
- Warm-ups -> **Where they go**: each campaign on or off, how many every 7 days (2 to start, 1-7), and from which
  categories (none ticked: every category).
- The Cutter plans them by itself (`warmupPlan.ts`): evenly apart (7 days / the number), at the accounts' best hour,
  **on top** of the day's batch videos; a filmed warm-up goes out once, ever; an idea never on the same campaign
  twice; the ideas whose warm-ups get the most views first (a new idea counts as 1,000 until it has views). Planned a
  week ahead at most, each sent at once (`warmupSend.ts`, when the app opens, every half hour, after filming, and when
  he changes where they go).
- Each **waits for his yes** in Posts with a notification of its own: "<campaign>: a warm-up to approve - It goes out
  Sat 7:05 PM - approve it in Posts before then." Server: `meta.warmup` (`batch.warmupOf`: its time kept, approval
  always his), the idea in the post's key `warmup:<idea>:<made>` - no database change.
- Each idea's card shows its warm-ups' average views.
- Tests: `warmupPlan.test.ts`, `batch.test.ts` (warm-up posts).

## Warm-ups, step 2: film several in one go
App only: run ./deploy.sh.
- Warm-ups -> **Film 5 in one go** (the ideas of the category shown that he has filmed least first), or **Film it** on
  one idea: each in turn shows its example, how to film it and its headline (change it if you like), then the camera
  opens with the idea's sound playing to move to, and stops by itself at the idea's length (the record ring fills over
  that length). Skip goes to the next.
- Each is made at once: what he filmed with its own sound left out, the idea's sound in its place, the headline in the
  idea's look (`warmupMake.ts`, the batch montage render). Checked here in Chrome for Testing: 6 s, the song heard, the
  clip's own sound gone, the headline drawn.
- **Ready to post** on the Warm-ups screen: the finished ones on this phone (Watch, ✕), each to go out once, ever
  (`warmups.keepMade`, meta `warmups:made`). Posting them per campaign is the next step.
- Recorder: optional `limitSec`, `sound`, `guide` (normal recording unchanged).

## Warm-ups, step 1: the shared ideas
App and server: run ./deploy.sh (it runs ./deploy-server.sh too - the ideas are kept by the cutter function).
Needs deploying: run ./deploy-server.sh
**What he said (2026-11-11):** a section for warm-up posts - "an already set text, an already set sound, an already set
amount of seconds, around 7 seconds, an already set editing" - that anyone using the Cutter can add to and use, his and
Ilyan's first, anyone else's waiting for his approval (he can change them first); categories Training and AI, new ones
approved by him. Under Trial reels in More.
- More -> **Warm-ups**: the ideas by category (All, Training, AI, and any approved), each with its example (a link that
  opens the post in Instagram or TikTok, or a video), how to film it, its headline (and look), its sound (played with
  ▶) and its length. + Idea adds one: title, category, example, how to film it, headline, sound (from the music bank or
  the phone - a video's sound is taken out of it), length (3 to 30 s, 7 to start).
- His own ideas and categories go up at once; anyone else's wait under "Waiting for your OK" at the top of his screen -
  Approve, Change it, Refuse. Ideas list his first, then his partners', then everyone else's.
- Settings -> People -> **Partner** (per login, e.g. Ilyan): their ideas come right after his and go up without waiting.
- Server: cutter actions `warmups`, `warmup-upload`, `warmup-save`, `warmup-approve`, `warmup-remove`, `warmup-urls`,
  `warmcat-add`, `warmcat-approve`, `partner` (`cutter/warmups.ts`; rows `warmup:<id>` / `warmcat:<id>` in cutter_config,
  files `warmup/<sha>` in cutter-files - an idea's sound has to play on every login, and each login's music bank is its own).
- Next: filming several in one go, then the weekly posting per campaign.
- Tests: `cutter/warmups.test.ts`, `people.test.tsx`.

## Motion graphics: everything in the middle square, more natural, his captions and his sound effects
App and server: run ./deploy.sh (it runs ./deploy-server.sh too - Claude's instructions are in the postiz function).
Needs deploying: run ./deploy-server.sh
**What he said (2026-11-11):** Format 2: "imagine a sort of square in the middle of the video ... I want all the visuals
to go inside that square", the headline too high, the visuals too large; every format "very, very, very repetitive";
cards he asked over his face went behind his head, half covered; "everyone knows that it's being edited with Claude";
the sound effects are "the basic Claude sound effects ... I honestly hate them"; captions "exactly like the cutter's
usual captions ... for any format, ever again".
- Format 2 (glass): every card, the title, the steps screen and the call to action sit inside a square in the middle of
  the frame (`glass.squareOf`); the title starts at the top of the square, not the top of the frame; cards are drawn
  15% smaller (`CARD_SCALE`).
- A new place "face": a card in front of him, over his face - what Claude uses when he asks for cards over his face.
  A card "behind" him now goes beside his head, on the side with more room at that moment (read off his cut-out,
  `behindBox`), so his head covers only its edge; with no room either side it comes in front instead.
- Less repetitive: cards come in four different ways (rise, slide from the left, from the right, pop up), and Claude is
  told never the same kind or place twice in a row, at least three kinds a video.
- Less "made by Claude": 4 to 8 cards a minute-long video at uneven gaps (was 6 to 12, every 3 to 6 seconds); plain
  words in his voice, sentence case - no forced CAPITALS, no letter-spaced labels, no "AI / edited by / 100%" labels
  unless he says them, a label on at most a third of the cards; the examples Claude copied ("100% EDITED BY CLAUDE")
  replaced; the opening title only when his first sentence makes a promise.
- Captions: the Cutter's own in every format (word by word or phrase by phrase, as on Videos); Format 2's caption bar
  and its word colouring are gone.
- Sound effects: the Cutter's made-up sounds are gone from motion graphics and from the edit screen's Sound picker.
  Motion graphics use his own sound effects (Music -> Sound effects), picked by name for each kind of moment (whoosh,
  swish, pop, ding, click, boom, camera - `sfx.KIND_WORDS`), taking turns when he has several; a moment with none of
  his effects for it is silent. Each is set to the same peak, under his voice.
- Lint: two server functions renamed (`keyIdOf`, `takeReconnected`) - the linter took their "use" names for React hooks.
- Tests: `sfx.test.ts` (his effects), `motion.test.ts` (place "face", no forced capitals), `motionView.test.tsx`.

## Audit, round two: the open items
App and server: run ./deploy.sh (it runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
His word on the first round's open list: do everything that needs no approval, and decide the rest for the best
experience (2026-11-10). Captions stay on Opus (he can't have bad captions); brand-name matching stays loose.

**What he will see**
- A new version no longer takes over while a video is being cut. It downloads, waits, and the page lets it in
  at a safe moment (`UpdateBanner.reloadIntoUpdate`; `skipWaiting` is off). Before, the moment it downloaded
  it deleted the old version's files from the cache under a page still cutting, and the next worker 404'd.
- One tab works at a time (`media/workLock.ts`, a Web Lock): a second copy of the page, or Cut only beside
  Campaign videos, says "Another Cutter tab is working on the videos" and looks again in ten seconds.
- Cut only: a cut that stops moving fails with the reason instead of sitting at a percentage for ever
  (`media/stallWatch.ts`, 90 s; 180 s while getting the speech model), with its copy kept for Try again; the
  working row has **Stop** (the page restarts to free the phone's video maker, the video comes back as failed).
- **Remove** can be undone for six seconds, on both pages (the row goes, an "Undo" notice stays).
- A video whose captions he checked keeps them whatever the Settings toggle says now (`wantsCaptions`); one he
  approved without captions gets none either way.
- Rows are titled by the first line he says once a video is listened to (`sort.firstLineHeadline`); the file
  name is inside the row. A clip with no talking keeps its name.
- The sticky summary and parts bars sit below the iPhone's status bar in the home-screen app.
- Captions, headline ideas and the other Claude calls run on `claude-opus-5-5`, the current Opus: same tier,
  newer, $4/$20 per million tokens instead of $5/$25 (`postiz/index.ts` MODEL, `recheck.ts` prices).

**Fixed underneath**
- A post sent "now" by a run the platform cut off mid-way is found again in Postiz, not made twice: the Postiz
  date is the moment the run marked it as going in (`creating_at`), and the next run looks there
  (`postiz/created.ts`; before, it looked around its own "now", minutes later).
- A try is counted before the video goes into Postiz, not after: a run killed mid-upload never reached
  `failed()`, so a video too big to upload within a run was put in again every tick, for ever. After
  MAX_ATTEMPTS such runs it comes back to him with the reason ("Putting the video into Postiz." is the note it
  carries meanwhile).
- Error reports: a signed-in phone's go in on sight (the token travels with them, `src/report.ts`); a
  signed-out phone gets ten a minute per address, all or nothing (429, the phone keeps them for later). The
  posting function's tick deletes reports older than 60 days, once a day (`sweepErrors`, cutter_config
  `errors-swept`).
- `reject` refuses a scheduled post whose time has passed, like `unschedule` does, instead of deleting a
  post that may already be out.
- Reaction videos: a decoder giving up mid-clip is picked up from the last frame written, up to a few times,
  like every other render (`clipParts.withDecoderRecovery`, the retry loop written once; `writeWhole` uses it
  too). Before, one "Decoder failure" failed the whole reaction.
- A pause of exactly the minimum length is found (`findSilentRanges` counts the run's last window): on the
  tight preset a 0.20-0.22 s pause was missed. A quiet word right after such a pause can lose ~20 ms of its
  fade to the existing MAX_GROW rule, as it already did after a longer pause.
- Speech windows of a pause-free stretch share half a second (`WINDOW_OVERLAP_SEC`), and a word heard in both
  is kept once (`timedWords.addHeard`); the letter model gets each word's own sound (`partWindows`). Before,
  the seam cut a word in two.
- Cut only leaves captions out when nothing was heard (no empty .srt); the row already says so.
- Frames out of order: the reorder buffer is 8 deep (`rangeReader.REORDER_DEPTH`; iPhone B-frame pyramids
  need more than 4), and a frame still earlier than the last one written is dropped and counted rather than
  stacked half a millisecond after it.
- One home each for `dbToGain` (sounds.ts), `planesOf` (clipParts.ts), `MAX_RECOVERIES` (media/recovery.ts),
  `UNREADABLE_FORMAT` (media/errors.ts), `SAFE_SAMPLE_RATE`/`audioConversionFor` (media/silenceCut.ts); the
  renders import them instead of carrying copies that could drift.
- Login tokens, video links and the sealed Postiz/Anthropic keys can each have a secret of their own
  (`CUTTER_TOKEN_SECRET` on both functions, `CUTTER_SEAL_SECRET` on postiz). Until he sets them, the service
  key is used as before, so nothing signs out and no sealed key is lost. Setting the token secret signs every
  phone out once; setting the seal secret means entering the Postiz and Anthropic keys again in Settings.
- `supabase/config.toml` now says `verify_jwt = false` for both functions, as deploy-server.sh always did.
- `supabase/migrations/20260927000000_cutter_login_sync.sql` writes down the login and sync tables and the
  `cutter-files` bucket as they were made by hand on the live project (read from the live schema; NOT applied
  there, harmless if ever run). The by-hand revoke of anon/authenticated on the posting tables is still in no
  migration file.

**Decided, not done**
- Self-hosting the speech model and its runtime: 55 MB more on every deploy for a problem the phone already
  solves by caching the model after its first download. Skipped.
- The review's remaining UI simplifications (per-sound dB panels, the campaign editor's confirm dialogs,
  "Postiz" vs "Posting" naming) wait for the fresh audit of the real screens, running now.

## Audit: the fixes that needed no asking
App and server: run ./deploy.sh (the caption prompt changed - deploy.sh runs ./deploy-server.sh too).
Needs deploying: run ./deploy-server.sh
An audit of both pages (UI, every backend step, the build), done first on the five-week-old `main` and then
brought over here, fix by fix, where it still applied. Nothing that changes how a feature behaves for him; the
open questions are listed at the end.

**What he will see**
- Rows that need him open by themselves (failed, held, unsure), with the reason inside; the row's line says
  "Failed", not the whole error twice. "Remove", "Share", "Share all", "Approve N", "Angle default: …", "Add…":
  shorter words, and icons (`icons.tsx`) instead of ✕ − + ▶ glyphs in the batch tab, clip rows and rows.
- A finished video not sent because no accounts are picked says so in one line with a **Pick accounts** button
  that opens the campaign's Posting set-up.
- The summary's **Check N** counts only the videos with talking in them and simply approves the reactions
  (`checkAll`); the drop zone says "Listened to first, so you can check the captions" when captions are on.
- The page opens on Day or One video next time, never inside a one-off flow (clips, joining).
- The iPhone picker tip (Format → Current) under the main picker (`VideoPicker tip`), and every clip picker
  tells the picker watch its files arrived, so a clip that came through is never reported as lost.
- Posts: an "Open video" link when only Postiz's copy is there; the empty state checks whether any campaign has
  accounts picked, not whether one has times saved.
- The plain cutter's row says what a video went without (note), and the update banner's words are shorter.

**Fixed underneath**
- Sync: one shared item whose picture or sound cannot be fetched is left for next time and everything after it
  still arrives (`cloud.pullAll`, `stuckAt`); before, it stopped every item behind it for ever. A new sign-in
  counts no file as uploaded yet (`store.forgetUploads`). The General campaign a fresh phone makes keeps its own
  `updatedAt` (`saveCampaign(asIs)`), so the first sign-in no longer pushes it over the friend's customised one.
- A video is kept, video and all, when its campaign or angle was deleted (Remove it, or add it again); it
  used to be forgotten with an error. A batch video whose copy for Postiz could not be kept stays in the list
  with its file instead of vanishing. A video hidden mid-way goes back in line at most twice
  (`MAX_INTERRUPTIONS`), then its failure counts.
- Caption fixes are written to disk a second after each change, not only on Done (`captionSaveTimer`).
- Disconnecting posting turns the notifications off too (`turnOffPush`); the screen follows the server saying the
  profile is gone (`watchPosting`); an angle removed on the other phone is no longer the one new videos are
  added for.
- The plain cut after the look failed keeps the "um"s out as he asked (`plainCut(..., cleanSpeech)`) and
  reports its real length; the music fades from the seconds left (`planDrift`), not the plan's; frames are
  closed in `finally` in every renderer; the HDR retry only for encoder failures (`encoderGaveUp`); out-of-storage
  told apart from a decoder giving up (`recovery.outOfStorage`).
- One speech worker for both pages (`media/transcribe.worker.ts`; the campaign one is gone), one sound decoder
  (`media/audio.ts`), one copy of the server's address and key (`config.ts`), one track-size limit
  (`music.MAX_TRACK_MB`). The video is stored before its row (`persistJob`), so a row with no video behind it
  never comes back to fail. Error reports go five at a time (`report.PER_SEND`): twenty came close to the 64 KB
  keepalive cap.
- The caption prompt marks the transcript and the headline as material, never instructions (`caption.ts`); his
  note and the campaign's rules stay instructions, as they are.
- Build: the version is the commit and its date (the same for every build of the same code, so phones stop
  re-downloading an unchanged 1.2 MB chunk; from Netlify's `COMMIT_REF`, Railway's `RAILWAY_GIT_COMMIT_SHA` for the
  Cutter server's image, or git - the build date when none is there), `push-sw.js` is versioned by its own hash, and the 27 MB
  "asyncify" WebAssembly nothing fetches is left out of `dist/` (`drop-unused-ort-wasm`). `/` loads the cutter's
  code only when the page is staying (`main.tsx`). `netlify.toml` sets the headers; `.oxlintrc.json` the lint.
- Tests: 1370 pass; `npx tsc -b` clean; `npm run lint` no new warnings; `npx vite build` 4.5 MB.

**Not done - his call** (from the audit): page-driven service-worker swap instead of `skipWaiting`; a
sound-alike matcher for words the model mishears; the pause rule; self-hosting the speech runtime; a
better caption model; captions per video vs the toggle; the held wording ("stopped" now also means by him).

## Edit screen: playing no longer pulls the page down to the captions
App only: run ./deploy.sh.
**What he said (2026-11-10):** "when I play the video, it always goes onto the captions ... Sometimes I want to stay on
top, looking at the video."
- The caption list follows the phrase playing only while he is already down at the captions (the list in the top part
  of the screen, `CaptionReview.captionsInView`). Up at the video and the timeline, Play leaves the page where it is.
- Test: `captionsFollow.test.ts`.

## Edit screen like TikTok's: step 2, sounds
App and server: run ./deploy.sh (it runs ./deploy-server.sh too - the sound effects bank needs the cutter function).
Needs deploying: run ./deploy-server.sh
- In the edit screen, Sound (in the toolbar, or "Add sound" in its lane under the clips) puts a sound on at the
  playhead: one from the sound effects bank, one of the Cutter's own (Whoosh, Pop, Ding, Click, Boom, Camera, Swish),
  a song from the music bank, or a sound file from the phone (a video's sound is taken out of it). ▶ plays it first.
- Each sound is a teal bar in the sound lane: hold its middle to move it, drag its ends to make it shorter or longer
  (never past its own length). Tapped, it has Volume (-30 to +6 dB) and how long it plays, and Delete. It plays along
  when the video is played in the editor, and is mixed into the finished video over the voice (also when the video is
  made on the Cutter server).
- Music -> a new **Sound effects** list under the songs: add whooshes, dings, a TikTok sound once, shared with every
  phone like the songs. Effects never show up as a video's music; "+ Add to the bank" in the sound picker adds one
  and puts it on at once.
- Checked here in Chrome for Testing: a Boom at 0.5 s and a song at 2.5 s of the recording (with a cut between) came
  out at 0.5-1.2 s and 2.0-3.0 s of the video, the song faded out at its end. Test: `editSounds.test.ts`.

## Edit screen like TikTok's: step 1, the timeline
App only: run ./deploy.sh.
**What he said (2026-11-10):** "make it more similar to this [TikTok's editor] ... there's a timeline ... I can adjust it
with my hands using some sort of arrows". His picks: the cut bits hidden like TikTok, frames + his words on the clip
bar, dark like TikTok; clip tools Split, Delete, Speed; a sound row (music bank, built-in effects, his phone, a sound
effects bank). This step is the screen and the timeline; Sound and Speed come next.
- Dark, like TikTok, whatever the phone's setting: round back button and a red arrow (Done) at the top, the video
  big, then the time, Play, Undo/Redo and full screen in one row.
- The timeline shows only what plays: the kept parts back to back as clips of little frames of the video, his words
  written small under them. Slide it to move, pinch it to zoom (as before).
- Tap a clip: a white frame with an arrow at each end. Drag an arrow inward to trim; outward brings back what was
  cut there, up to the next clip's footage. The start's arrow stays under the finger while dragging; the clips close
  up when it lets go, and the playhead lands on the new edge. The tools along the bottom become Back, Split (at the
  playhead, on that clip), Delete.
- Under the clips, a row of bars: the headline and each text, picture or video put on. Tap one to edit it (the same
  panel as before); hold its middle to move it along the video, drag its ends to change when it starts and how long it
  stays.
- Nothing tapped, the tools along the bottom are Text, Overlay, Captions (scrolls down to them), Headline and, when
  there are sounds to check, Check.
- The quick caption check (the first screen) is dark too; otherwise unchanged.
- Tests: `cutsTimeline.test.ts`; the editor tests now tap a clip before Split/Delete. Checked here in Chrome: trimming
  both ways, undo, moving and stretching a bar.

## Batch: one video, new songs
App only: run ./deploy.sh (the Cutter server rebuilds by itself).
**What he said (2026-11-09):** "a batch for just one single video and variations of that same exact video ... it's the
same video with only 5 different audios" - audio only for now, no text changes. His picks: the sound automatic, the
copies into the campaign's batch.
- Batch tab, under Music: **One video, new songs**. Set "Copies of each" (5 to start, never more than the batch has
  songs), tap + Add, pick the video. The batch posts it again that many times on its next free times, each copy with a
  different song from the batch's Music.
- The picture is the video exactly as it was: its frames are copied, never redrawn or encoded again (checked here: the
  copies' picture is byte-for-byte the original's). Only the sound is new (`songSwap.ts`).
- Sound, decided by itself: the video is listened to once when it goes in (`copyTalk.ts`). You talk in it -> your voice
  stays, the song quietly under it (dipping while you talk). No talking -> the song replaces the video's sound. The card
  says which ("Your voice + song under" / "Song only"); tap it if it heard wrong.
- Copies are made even with the batch's own videos stopped; Stop stops them too, Start lets them go on; each has its
  own Stop/Go on, - and + for the number, and ✕. A copy taken out before it was made gets made again with its song.
- A clip trimmed on the iPhone (hidden frames before its start) is the one case drawn again, from its first real frame.
- Works on the Cutter server: the video goes up with the bank, and the server no longer deletes it as unused.
- Tests: `copies.test.ts`; renders checked in Chrome for Testing (6 s and a trimmed 4.7 s clip, both sound modes).

## Batch: Stop holds - on the Cutter server too
App only: run ./deploy.sh (the Cutter server rebuilds by itself).
**What he said (2026-11-09):** batches "never stop being made, even after you click on Stop ... indefinitely until you
actually make a new batch"; it worked for him, not for his friend (same "yes" login, each with his own server).
- Why: the server reads the phone's bank (Stop included) while it may be planning that batch's next day. The top-up
  then saved its plan - read before the Stop, so still "running" - over it. The server was running again for good, while
  the phone showed Stopped and never sent the Stop again (nothing changed on its side). Not the shared login: each
  phone and each server keeps its own batch.
- Fixes: (1) the server takes in the phone's bank only after a top-up of it has finished (`serverMode.takeInbox`,
  `nextInLine`); (2) every top-up's save keeps a Stop made while it planned (`batchRun.keepStopped`); (3) the server,
  told a batch stopped, drops its videos queued and not started, as Stop does on the phone (`SERVER_STOP_EVENT`,
  `stopBatch`); (4) the phone sends the bank again whenever the server says running and the phone says stopped (or the
  other way) a minute after it went (`serverLink.linkBank` `apart`) - a batch already stuck going on fixes itself
  the first time the phone opens the app after this deploy.
- Test: `keepStopped.test.ts`.

## Talking head formats: the product steps keep his voice, played whole, the music low under it
App only: run ./deploy.sh.
**What he said (2026-11-08, "number one priority"):** in a talking head video "it's going to be very awkward if I talk at
the start ... and then it's just showing the product and not saying anything, with music". His talking clip is the hook;
then product steps ("Step one: go to this website") that "come pre-cropped, pre-edited" with him talking over them -
"leave the sound ... the music has to be a little quieter because we need to hear our voice".
- In a talking head format (and a green-screen one he talks in), every clip keeps its own sound now, not only the hook:
  each product step (or showcase) plays whole - it comes edited - with his voice-over, its step name written over it as
  in reactions (`montageRender` `voiceAll`, `CampaignApp`: no picked moment for a talking video). The music goes under
  the whole video at the quieter level ('low', 14 LU under the voice instead of 9) and still dips while he talks.
- Reaction formats are unchanged: the step plays its moment, muted, under the music.
- The talking head card says so: "You talking - the hook", and each step "played whole with its own sound - your voice
  saying what to do - the music low under it".
- Checked here in Chrome for Testing: a 3 s hook + a 4 s step with its own sound -> 7 s, the step's sound as loud as the
  hook's (before: silent).

## Accounts: a two-letter platform mark after the username
App only: run ./deploy.sh.
- Every account label is "@username · TT" / "· IG" / "· YT" / "· FB" (`posting.platformMark`), so a TikTok and an
  Instagram with the same username can be told apart (his ask, 2026-11-08). Test: `accountLabel.test.ts`.
## Batch: a clip in a Talking head format always keeps its sound
**What he said (2026-11-08):** "For batches with talking heads ... all the reaction clips are muted, but they have
to have sound on every single one of them."
- Whether a clip of him keeps its sound now comes from the format it is in (`batch.talksIn` -> `formatTalks`): a
  Talking head format always, a green screen when "You talk in these" is on. Before, only the mark stored on each
  planned video counted, and a video planned from the whole bank - a remake after taking out a hook - lost it
  (`batchRun` remade them from the bank, where his clips carry no mark of their own): music only.
- When a video is made, the phone (or the Cutter server) also looks up the clip's format itself, so a video already
  planned without the mark is made with his voice and captions anyway (`CampaignApp` `keepsVoice`).
- If a talking clip ever gives no sound, the render now sends a `voice` report saying whether the clip has a sound
  track and whether it could be read - so the next muted video says why.
- Videos already made muted stay as they are; the ones still to be made get his voice.
## Trial-reels-only logins get Posts too
App only: run ./deploy.sh.
**What he said (2026-11-08):** "For Sam, can you add a post section too, because he can't even approve or see the
posts that are being scheduled?" - a Trial-reels-only login (samtpnq) had Trial reels and nothing else.
- At the top of that login's app: **Trial reels | Posts** (with how many wait for approval). Posts is the same Posts
  screen as everyone's: to approve, scheduled, posted, failed, with Approve, Take back and Stop - its own posts only
  (the server lists each login's own). No "+ New post" there: that login can post Trial reels only, so the server
  would refuse it.
- `CampaignApp` (trial-only layout, `tab` 'posts'), `PostsView` `newPost`.

## Motion graphics: Format 2 is now the glass look (the old Format 2 is gone); always a call to action
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** sent a reel - "I want the formats to look a little more like this. I want claude to
be able to edit just like this" - then "Keep format 1, remove format 2, and put this as format 2 ... Claude can just
write the title on top of my head at the start ... there's my face, and then there's the glass behind me ... always
have a call to action at the end ... most of the time the call to action is going to end with UGC."
- Format 2 · Glass (`motion/glass.ts`): his face full screen; every few seconds a frosted glass card slides up and
  goes - a small label and a bold line with one word in an orange pill, a row of blocks whose red ones close up
  ("cuts the dead space" -> "tight. no filler."), a number counting up over growing bars (with confetti), a picture
  card with a big emoji. Claude puts each one under his face, at his side, or BEHIND him: then he is cut out of the
  frame as it is made (the green screen's cut-out tool, `motion/liveCutout.ts`, only on those frames) and drawn back
  over the card, his head in front of the glass. If the tool can't run, the card goes over him and the video is
  still made.
- For a list of steps the whole screen turns light blue, his video shrinks into a rounded box under the list, the
  numbered rows slide in on their words, and it grows back.
- A title over his head at the start (Claude writes it), captions in a dark bar word by word with an orange word
  now and then and key phrases in a white pill with a green tick, and the shot moves a little closer or back out at
  the cuts.
- Every video, both formats, ends on a call to action: his own words when he says one, else 'Comment "UGC"'. The
  glass look shows it as a glass pill with a chat drawing and a pulsing ring; Format 1 as its banner.
- The old Format 2 (words) is removed. A video still on the phone planned in it goes back to its caption check and
  is planned again as glass. Its tap-to-style chips now cycle orange -> pill -> normal.
- The glass cards are frosted by shrinking and growing a copy of the frame (Safari has no canvas blur).
- Checked: a real render in Chrome (12 s, made in 18 s) with the cut-out running, and stills of every card. Not
  checked on the iPhone.

## Motion graphics, Format 1: the board less often, pop cards over his face, animations
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** "Format 1, I don't want the white screen to always be there ... The drawings ... look
pretty mid ... What I meant is probably some animations."
- The board is now for the 2-4 big moments only (a comparison, a sum, a grid, steps), 3-7 seconds each, with his
  face between. Claude is told so, and a board scene longer than 22 words is cut short (`MOTION_LIMITS.boardWords`).
- New: pop cards. The rest of the time a small white card with a drawing and 1-4 words ("Goes viral", "Only 2
  hours") springs up over his face, tilted, floats while he talks and shrinks away - the board stays down. A
  swish as it comes in. A caption set at the top steps down while one is up. The plan screen says which scenes
  are "Board" and which are "Card over your face".
- Animations: every drawing now draws itself on, line by line, then keeps moving its own way - the rocket shakes
  and lifts, the heart beats, money and gifts float, the clock and megaphone wiggle, fire and bolts flicker, charts
  bob up (or down). Discs pop out a touch past their size. Confetti bursts when a big number or a sum's result
  finishes counting.
- Plans made before this still play as they were (no pop cards in them).

## Motion graphics: the caption check before the plan, and the words of Format 2 can be changed
**What he said (2026-11-08):** "With format number 2, I click on them ... I can make them italic, bold, and
yellow, but I cannot even edit them ... Claude checks the captions, and then I review or approve, say they're
good, or fix them? That's exactly the format that I want."
- Right after the video is heard, before Claude plans the graphics, the same caption check as on Videos opens by
  itself: Claude reads the captions, only what it changed or isn't sure of comes up one at a time - Good, Undo or
  Fix - then "Approve - plan the graphics". "All captions" opens every phrase; "Make it without captions" turns
  them off. His video plays above it.
- Claude plans the graphics from the words as he approved them, so names and numbers on the board are spelled the
  way he fixed them (`make.claudeWords`; the storyboard's word numbers still point at the words as heard).
- Format 2's "Your words": tapping a word still changes its look; a "Change the wording" button opens the same
  caption screen to change what it says.
- A video heard but not checked yet comes back to the check (`session.checked`).

## Accounts shown by their username, everywhere
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** in Analytics, "accounts that stopped getting views ... it's just the name of the account.
Most of these names are just the first name, and they're usually the same ... Always, always, always put the username.
I don't care about the name."
- `posting.accountLabel` is now "@username" alone (the name only for an account with none, like YouTube) - every list,
  picker and line that names an account: Posts, Batch, campaign Posting, Trial reels, Analytics.
- "Accounts that stopped getting views": the server now keeps each account's username (`deadAccounts.ts` `profile`) and
  the card and its notification say "@username on Instagram may be shadowbanned" (`userName`); the card also finds the
  username of an account the server named before.
- The server's own lines say "@username" too: "Not posted to ...", "Held back: ... is paused", the Buffer notes. A posted
  video's links are labelled by username (`linkLabel`). Stored keys (views and links by account name) are unchanged.
- Tests: `accountLabel.test.ts`, `analyticsView.test.tsx`.
## Motion graphics, Format 1: drawings on the board
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** "make the white part on top less plain right now its just text could be nice if we
had some drawings".
- 36 drawings made for the app (money, coins, charts up and down, video, camera, phone, eye, heart, star, fire, bolt,
  clock, calendar, people, target, bulb, lock, gift, cart, megaphone, trophy, warning, question, chat, play, globe,
  home, rocket, check, cross, arrow, hashtag, brain, tools) - simple line icons on a soft disc in the board's
  colours, drawn from code: nothing to load, sharp at any size, the same on the phone and the server
  (`motion/icons.ts`).
- Claude now gives most titles, cards, list rows and big numbers a drawing that fits, and a new part: a row of 2-4
  big drawings with a word under each, for the key ideas (Film · Automate · Grow). Each pops in on its word, with a
  pop sound.
- The board itself is no longer plain grey: a faint dot grid and two soft glows of purple and green.

## Motion graphics: Claude checks the captions, as on Videos
App only: run ./deploy.sh.
**What he said (2026-11-08):** "add the claude inside the captions that verifies if they are good".
- Edit captions on a motion video now has Claude's caption check, the same as on Videos: it runs by itself the first
  time the captions are opened (and again on a tap) - the words it thinks were heard wrong come back fixed, each
  marked to keep or undo, the ones it isn't sure of flagged. Claude is told what the video is about: what you asked
  for and the words on its graphics (names, numbers). The plan's button says "Edit captions · Claude checks them".
- What Claude fixes is what the video shows - in Format 1's captions and in Format 2's words.

## Motion graphics, Format 1: a smaller board, more of your face
App only: run ./deploy.sh.
**What he said (2026-11-08):** "format one the white screen part takes too much of the screen make it take less".
- The board now covers the top 44% of the frame (was 55%, his friend's), its fade into the face shorter, and the face
  moves down less (28% of the height, was 38%) - his whole face shows under it. The graphics fit themselves to the
  smaller board as before (`draw.ts` BOARD_BOTTOM, FACE_DROP).

## Motion graphics: Format 2's words - tap any word to make it big, gold or fancy
App only: run ./deploy.sh.
**What he said (2026-11-08):** "captions on this formats are not really customizable, since theyre custom and
outside the cutters actual captions, i cant actually edit them".
- On the plan of a Format 2 video, Your words: every block of words as chips, Claude's picks lit (big dark, gold,
  fancy italic). Tap a word to go big -> gold -> fancy -> normal; the big picture jumps to that moment to show it.
  Kept with the plan; the chat with Claude keeps your choices unless you ask it to change them.
- Edit captions still fixes the words themselves, where they sit and how big - all of it shows in Format 2's words
  (since the last update). Its "one word / highlight" choice is hidden in Format 2, where it did nothing.

## Motion graphics: the words follow the caption settings, and never cover the graphics
App only: run ./deploy.sh.
**What he said (2026-11-08):** "I put them at the bottom, but the VFX captions are independent ... it's going to stay
the same", and "let's say there's a list, 1 through 3. The captions get in the way of that list" (Format 2).
- Format 2: the words under your face now sit where you put the captions on Edit captions - Top, Middle, Usual or
  Bottom - and are as big as the size you picked there (`Kinetic.centerY`, `scale`, `words.BLOCK_CENTER`).
- The numbered diamonds and the point labels place themselves clear of the words: just under every block said while
  they are up, or just over them when the words are low (Bottom) - worked out once per moment, so they never jump
  (`bandBetween`, `clearOf`). The dimmed word and the gold end words sit where the words do.
- Format 1: captions set to Top or Middle drop under the board while it is up (they would cover the cards), and go
  back when it slides away; Usual and Bottom stay where they are (`draw.captionPositionAt`, in the render and the
  plan's stills).
- The little preview phone of Format 2 no longer blanks between its blocks.

## Motion graphics: sound effects, by themselves
App only: run ./deploy.sh.
**What he said (2026-11-08):** "can we also add some sound effects".
- Every motion video gets sound effects on its graphics, worked out from the storyboard - nothing to pick: a whoosh
  as the board comes up, a pop as a card or part comes in, a tick for each line, square, price and diamond, a ding
  as a sum's result or a big number counts up, a deep hit on a gold word and on a dimmed moment, a swish on a big
  word or a point, a camera flash on a white flash. Never two closer than 0.18 s (the stronger one stays), all
  under the voice.
- On the plan: "Sound effects" says how many and which, with Hear them (plays each once) and a switch to make that
  video without.
- Underneath: `motion/sfx.ts` (the sounds made from maths like the look's own - nothing to load, the same on the
  phone and the server; `motionSounds`, `soundsByName`), render.ts `motion.sounds` placed like the look's sounds,
  `make.soundsFor`, `MotionSession.noSounds`. Checked on a real render: each sound at its planned moment.

## Motion graphics: "The object can not be found here" when making
App only: run ./deploy.sh.
**What he said (2026-11-08):** "the motion graphics say it couldnt be made: The object can not be found here"
(report 1522, phase `motion make`).
- The recording was kept inside the session record, and that record was written again at every step (a chat
  change, a caption fix). Safari deletes a stored file when its record is written again, and the video the screen
  held from before could no longer be read - Make failed. Now the recording and the made video each have a record
  of their own, written once (`motion/session.ts`); and Make reads the recording fresh from storage
  (`freshFile`). A video kept the old way is moved over once when Motion graphics opens - his plan is not lost.

## Trial reels logins: posting keys easy to find, and a warning about Buffer
App only: run ./deploy.sh.
**What he said (2026-11-08):** "make Sam TPNQ log in to let him go to his settings so he can change his API key from
Postiz to Buffer". samtpnq is a Trial-reels-only login (People): its app is Trial reels and nothing else, so it has
no Settings tab - its keys are behind the link at the bottom of Trial reels.
- That link now says "Posting keys (Buffer or Postiz) and Claude", and opens the setup with the Buffer / Postiz
  choice - Postiz first for this login, and with Buffer picked it says plainly that trial reels can't go through
  Buffer (it would post them as normal Reels to his followers), so a Buffer key would post none of them.

## Motion graphics: Claude's "Schema is too complex" fixed
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** "Claude said: 400 ... Schema is too complex. When generating motion graphics".
- The strict answer format (a JSON schema) had grown too big for the API with the two looks and every part's
  fields. Claude now answers plain JSON, shown the exact shape in its instructions (`motion.ts MOTION_ANSWER`), read
  even with a code fence around it (`parseMotionAnswer`); `cleanStoryboard` still keeps only what is valid.

## Posting: set up with a Buffer key or a Postiz key
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** "for samtpnq account why are you forcing him to put a postiz api key, it can be a
buffer api key too that works better, make it so he can put either one" - samtpnq had been given a friend's Postiz
key, so its posts would have gone to that friend's accounts and shared his Postiz hour.
- Settings, Posting setup: Post through Buffer / Postiz (Buffer first), then that key and the Anthropic key. A
  Buffer key makes a login that posts through Buffer only: its accounts are the key's Buffer channels (Instagram,
  TikTok, YouTube, Facebook...), picked per campaign as before.
- Each video goes into Buffer 6 hours before its time (Buffer's free plan holds 10 a channel), at its time; a full
  channel or a refusal is tried again every 10 minutes and then shown. Posted / failed and links come back from
  Buffer as for the backup. Trial reels need Postiz (Buffer would post them to followers) and say so. Views
  (Analytics) come from Postiz, so a Buffer login has none yet.
- Settings shows "Posting · Buffer" with its channels; another key adds its channels; no "Postiz is down" switch
  and no taking the key out.
- Underneath: profile `settings.via = 'buffer'`, `connectBuffer`, `scheduleViaBuffer`, `backupFor` (each account is
  its channel), `refreshAccounts` reads Buffer; `postiz()` never sends a request without a key (a Buffer login keeps
  an empty sealed Postiz key - the column can't be empty - so no table change). `buffer.ts channelAccount`.

## Motion graphics: Format 2 (words), a look picker, and examples to tap
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-08):** "can we make like different type of formats? ... This is Format #2", "go built format
2 and when choosing give description and little ui", "in the what you want (optional) give me some examples".
- Before dropping a video: Which look - Claude picks / Format 1 · Board / Format 2 · Words - each a little phone
  playing that look, with a line saying what it is for. The pick is remembered.
- Format 2 · Words (his example reel): your face stays full screen under a dark cinematic edge (warm or teal); your
  words build up word by word in a block under your face - small words, the key one huge (white, or gold capitals),
  a fancy italic word before a big one ("the Three"). Numbered cyan diamonds light up when you announce a list, a
  diamond with an UPPERCASE label for each point, a white flash with your words in black, a dimmed moment with a
  word over it ("Bruh...."), big gold words at the end ("DM 'EDIT'"). The block is the caption: fix its words on
  Edit captions as before, and the words Claude made big stay on them.
- "What you want" has examples for the look you picked: tap to add, tap again to take out.
- On the plan: which look it is (and that Claude picked it), and Switch to the other look - planned again.
- Claude is told the look (or to pick: the board for numbers and money, the words for stories and tips).
- Underneath: `motion.ts` `format`, `emphasis`, `grade`, parts `diamonds`/`point`/`flash`/`dim`; `motion/words.ts`
  draws it; `motion/FormatPicker.tsx`; render.ts `motion.kinetic`. Plans made before keep the board look.
- Tested here: rules, layout and drawing (vitest), the picker in a browser, and a real 20 s render in Chrome for
  Testing with every part of the look. Not tested: an iPhone, a real plan from Claude.

## Motion graphics: captions you can fix, like on Videos
App only: run ./deploy.sh.
**What he said (2026-11-08):** "make it a little editable just like the cutter. meaning captions i can edit them".
- The plan screen has Edit captions: the Cutter's own caption screen on this video - type into any phrase, move
  them (Top / Middle / Usual / Bottom), size, one word or Highlight - or make it without captions. Done goes back to
  the plan; the stills and the made video show the captions as you left them. The graphics keep their moments
  whatever you type (their word numbers stay on the words as heard).
- Kept with the video on the phone (`MotionSession.captions`, `motion/make.ts` `CaptionChoice`, `shownCaptions`).

## Motion graphics: no more 504, and something to watch while Claude plans
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-07):** "Server said 504", and "when it says claude is planning the graphics, make a little
ui showing anything ... its boring and idk if its working".
- The 504: Supabase cuts a request off at 150 s, and Claude took longer (the server's log: 150 112 ms, 04:28). Now
  `motion-plan` answers at once with a job and Claude works in the background; the phone asks `motion-result` every
  3 s until the plan is there (`posting.motionPlan`), through dropped connections too. Claude also plans at low
  effort now - picking and filling parts from the words is quick work - so it fits well inside the server's limit.
  A job still going after 7 minutes is said to have been stopped; the phone gives up after 8 and says so.
- While it plans (`motion/Planning.tsx`): a clock counting the seconds, your words with a light moving through
  them, the numbers you say popping up one by one ("10K", "25 dollars", "10 000 views" - what graphics are made of),
  and the style of the graphics playing over your own video. Changing the plan in the chat shows the seconds too.
  Nothing on it pretends to know how far Claude has got.

## Motion graphics: drop in a talking video, Claude puts graphics around what you say
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-07):** "I just drop in the videos, and it does it automatically", like his friend's reel,
and "is there a way to check before if it's good ... an explanation of how it would look like before?"
- More -> Motion graphics. Pick a video (and, if you like, a line of what you want). It is cut and heard like on
  Videos, then Claude writes a storyboard from your words: a counter over your face at the start, scenes where a
  light board slides over the top and your face moves down under it - titles, cards with ticks and crosses, lists,
  grids of squares filling up, phones with view counts, sums that count up - each coming up on the word you say it,
  and a follow banner near the end.
- Before anything is made you see the plan: one line and a picture per scene, a big picture you can slide through
  to any moment, drawn by the same code that makes the video. Type what to change ("make the sum come in later",
  "drop the phones") and Claude changes it and says what it did. Then Make; Save / share when done. "Change the
  graphics and make it again" goes back to the plan.
- Every step is kept on the phone: closing the app never loses the video or the plan. Only your words go to
  Claude (server action `motion-plan`, your Anthropic key, about 3-10 cents a video), never the video.
- Underneath: `motion/draw.ts` draws the board and parts on each frame; times are word numbers, placed like the
  captions (`motion/track.ts`); render.ts draws it when given `motion`, nothing changes for any other video.
- Tested here: the storyboard rules, the drawing of every part, the plan screen and chat (vitest), and a real
  render of a 62 s video in Chrome for Testing (made in 18 s, graphics on the right words). Not tested: an iPhone,
  and Claude's own storyboards (the key is on the server).

## People: a sign-in link for Trial reels and nothing else
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-07):** "make a new account for SAMTPNQ ... we want a magic link ... Only access to one feature:
TRIAL REEL REPURPOSING. NOTHING ELSE".
- Settings -> People, "A sign-in link for someone new": a new tick, **Only Trial reels - nothing else in the Cutter**.
  The link is made as always (once, 48 h, they pick their password, their own empty space - nothing of his) and the
  login is marked Trial-reels-only before it can be opened: Trial reels on, and cutter_config `trial-only` (a list of
  space ids, as `trial-reels` - no table change). People shows it as "Trial reels only", with no switch to turn them off.
- The lock is the server's: the posting function refuses any video from such a login that isn't a Trial reel copy
  ("This login can only post Trial reels.", `postiz/trial.ts trialOnly`, in the send); its profile says `trialOnly`.
  Sign-in and the link answer `only: 'trial'` (cutter `login`, `accept-invite`, `whoami`), kept with the session.
- On their phone the Cutter is Trial reels alone: setting up their Postiz and Claude keys first, then the Trial reels
  screen, and Sign out - no tabs, no other screen (`CampaignApp`, `TrialView` without Back).
- Tests: `people.test.tsx`, `postiz/trial.test.ts`.

## Never a frozen face: a decoder that stops handing frames over is caught and picked up again
App only: run ./deploy.sh.
**What he said (2026-11-07):** a VAZA video "at exactly 2.5 seconds ... simply froze. The rest of the video kept going
... captions ... images ... my voice kept going, but my face just was stuck in time. Never let this happen again."
- Why: the frame reader (`media/rangeReader.ts`) treats "the decoder has no more frames" as "this part is over". When
  the phone's decoder stops handing frames over partway - with no error, which is what Safari sometimes does - the
  render held the last frame to the end of the part while the sound, captions and pictures went on. A decoder that
  threw an error was already picked up again; one that went quiet never was.
- Now, after every part, the frames read are checked against where the part (or the video's own frames) ends: more
  than half a second short is the decoder having stopped (`media/recovery.ts` `StoppedEarly`, `stoppedEarly`), and a
  fresh decoder picks up after the last frame written, as for one that gives up - in the talking-video render
  (`render.ts`) and every clip written whole (`clipParts.writeWhole`: joined recordings, batches, green screen,
  clips before/after). If it keeps stopping at the same moment, the video isn't made and he is told where and why
  (`stalledProblem`) - never sent out frozen. The plain cutter (`media/silenceCut.ts`) is unchanged.
- Checked here: a real join of three clips in Chrome for Testing - 600 even frames, nothing wrongly taken for a stop.
  Tests: `media/stall.test.ts`.

## Recorder: every take steadied, as the Camera app does
App only: run ./deploy.sh.
**What he said (2026-11-07):** "when I pick up my phone and I film with the back camera, or even ... the front camera
too, it's so shaky ... Can you add a stabilizer".
- Why: the iPhone's Camera app steadies its videos; a web page gets the camera without that (Safari has no setting for
  it), so every take carried all of his hand's shake.
- Now (`stabilize.ts`), when he taps Done each take is steadied: every frame measured against the one before, small
  and grey, on the left and right edges - not the middle, where he moves - each counted only in the directions it has
  detail in (a plain wall tells nothing), the two edges moving apart read as the phone tilting; the camera's path
  smoothed over 0.8 s (a slow pan stays, the jitter goes); each frame moved and turned back onto it, zoomed only as
  much as that needs (at most 15%). The sound is copied as it is; colours go through the usual re-tagging. A steady
  take is left alone, and a steadied one is kept only when it measures at least a quarter steadier - otherwise the
  original stays.
- In the recorder: a "Steady" button under the flip button (on, remembered when turned off); "Steadying the picture
  · 40%" with Skip after Done. Each take's result goes in his report (`check` / `steady`).
- Checked here in Chrome for Testing on a made-up shaky 8 s 1080p take: shake 8.9 -> 0.8 px a frame, zoom 1.04, 14 s;
  on a test pattern with its own moving shapes, the original was kept. Not checked on an iPhone.
- Tests: `stabilize.test.ts`.
## Motion graphics with Claude - research only, nothing built
Nothing to deploy.
**What he said (2026-11-07):** use Claude to put motion graphics around a video, with a chat to fix them, in its own
section, maybe with "Maloy Studio".
- `docs/MOTION_GRAPHICS_RESEARCH.md`: how templates work (.mogrt, Lottie, Remotion, cloud APIs), "Maloy Studio" =
  Malloy Studio (malloy.sg - transparent video exports, no API found), how Claude would pick and fill our own
  templates from the words and fix them by chat, what runs on the phone vs the Cutter server, cost per video, and
  questions for him. No app code changed.

## Trial reels: "Make again" - every copy not out yet taken out and made again
App only: run ./deploy.sh.
**What he said (2026-11-06):** "it does the same exact thing for me ... Is there a button to do that, to fix the videos
that are already scheduled?" His 49 copies not out yet (30 approved, 11 in Postiz, 7 waiting) were all 14 s.
- The automatic clean-up of the doubled copies now measures a clip whose length the bank doesn't have, and takes the
  ones still uploading too.
- Trial reels has a "Make again" button: every trial copy not out yet - from Postiz too - is taken out and the loop
  makes new ones for the same days; the reels, the number a day and the approval of each reel stay
  (`TrialView.remakeAll`).

## Trial reels: a copy is its clip once - it played the clean clip a second time, without the words
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-06):** for Ilyan "the original video plays first ... the raw video plays right after. It makes
a 16-second video when it should be only a 7- or 8-second video". His copies were 17.9 s.
- A trial copy is a batch video whose reaction and "product" are both the clean clip (`planTrialVideos`), and the
  maker took the product as a second clip (`CampaignApp.montageClips`): every copy was the clip with the words, then
  the same clip again without them - twice as long, on every phone and the server. That was also the "loop" he
  reported earlier. Now a trial copy is its clip alone (`montageClips` returns none for `bank.trial`).
- The copies made before, not out yet, are taken out once when Trial reels opens and made again: a copy longer than
  half again its clip (`trialLoop.doubledCopy`, from each post's `duration`, now in the posts the phone reads).
- Test: `trialLoop.test.ts`.

## Trial reels: what it is doing, at the top - made where, the copy being made, each day
App only: run ./deploy.sh.
**What he said (2026-11-06):** "make a UI for trial reels to make sure if they're being sent or being made or not,
because right now it doesn't say, and it kind of doesn't look good".
- Trial reels now opens on the Batch tab's status panel (`BatchStatus`): what the loop is doing in one line ("Making
  videos", "All set", "The server went quiet", what went wrong), where (this phone or the server), the copy being
  made now with how far it is, how many wait to be made, the clips going up to the server, when the last copy was
  ready, and the next 3 days - each with gone out / ready / being made, against Instagram's trial limit a day
  (`statusDays` takes `most`). Stop everything and, for copies that couldn't be made, Try again sit in it.
- Below it: copies a day and the reels, then the copies themselves (To approve / Going out / Out); the old one-line
  counts and the "being made" card that said the same twice are gone. It redraws whenever the server reports.

## Trial reels: a reel and its clean clip of the same length start together - the sound never loops
App only: run ./deploy.sh.
**What he said (2026-11-06):** Trial reels don't work for Ilyan: "it makes his videos loop, both vids same length, he
is correctly selecting the viral one". His 106 copies were 17.9 s each.
- The viral reel's start is found by matching the clean clip's first picture in it. A picture that comes back later
  could be taken as the start, and the sound was cut from there - shorter than the clip - and a batch's sound starts
  over when it runs out. Now the start can't be later than the viral reel is longer than the clean clip (+0.25 s):
  the same length, it starts at 0 (`viralReel.startOf` `latest`). And a Trial reel's sound never loops
  (`montageRender`, `MusicBed` loop off for `keepLines`).
- Each start is reported (`check` / `trial`: both lengths, the best match, where it starts) so the next one can be read.
- A reel started before with a sound shorter than its clip says so on Trial reels: "Its sound is N s shorter than the
  clip - Stop it and start it again with the same two videos" (the viral reel itself isn't kept, so it can't be redone
  by itself).
- Test: `trialLoop.test.ts`.

## Trial reels: every reworded headline checked by Claude - it has to make sense
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-06):** a trial reel went out saying "I promise you this is the most starving I've ever been",
which "literally makes no sense ... Use AI inside of it to make sure that it makes sense."
- The rewordings were written in one go with "change one or two words" as the only rule, and nothing read them again.
  Now the instructions say each must be something a native speaker would actually say (with this very example), and
  a second Claude pass reads every rewording, keeps only the natural ones that mean the same, and writes new ones in
  place of the rest (`postiz/trial.ts` `REWORD_CHECK_SYSTEM`, `checkedRewordings`; `index.ts` `checkRewordings`, in
  `trial-read` and the new `trial-reword`).
- Reels already running are checked once when Trial reels is opened (`TrialView`, `trialLoop.withCheckedWords`,
  `TrialRead.checked`); copies with a dropped wording not out yet are taken out and the loop makes others in their
  place. What already posted can't be changed.
- Tests: `postiz/trial.test.ts`, `trialLoop.test.ts`.

## Talking head formats: captions of what he says
App only: run ./deploy.sh.
- A talking head format's clip plays whole with his voice and now his captions too - in his own caption style, size
  and position (Settings), unless captions are off. Each clip is listened to once, the first time a video is made
  from it (`talkCaptions.ts` `talkWords`: the whole clip, never cut, timed with the letter model), and the words are
  kept by what is in the clip, so every later video reuses them; montageRender draws them over the first clip
  (`captions`). A clip that can't be heard is made without captions, and says why in his report (`talk captions`).
- Not yet: captions on a green screen format where he talks.
- Test: `talkCaptions.test.ts`.

## Batch formats: more of the ones whose videos get more views
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
- Each batch video's line keeps its format on the server too (`postiz/batch.ts` `format`, in the posts the phone
  reads). Once two formats each have 5 videos out with their views, each gets its middle views against the middle of
  all of them as its share of the day, between half and twice an even share (`batch.formatSharesFrom`, kept in
  `BatchBank.formatShares` whenever the Batch tab reads the posts; the server makes by it). Its card says so: "Gets
  1.6× its share of the day - its videos get more views". Until then, even.
- Tests: `batchFormats.test.ts`, `postiz/batch.test.ts`.

## Batches: one batch per account, made of formats - reaction, talking head, green screen
App only: run ./deploy.sh.
**What he said (2026-11-06):** the talking / not-talking batch screen was confusing. "Reaction batches, talking head
batches, green screen batches - all three are going to post under the same account ... I don't have to create a new
batch ... they're going to work as formats ... it's not always going to be the same exact video behind me ... different
angles sometimes." His picks: each format has its own clips of him and its own product (or steps); headlines, looks
and music are the batch's; formats take turns evenly (by results next); talking clips play whole with captions (next).
- **The Batch tab:** status and Start at the top as before, then **Formats** - one card per format: its kind (Reaction,
  Talking head, Green screen), his name for it, how many clips of him and product clips it has, and how many different
  videos it can still make (or what it needs, in orange). Tap a card to open it: its name, its clips of him, its
  product showcases or product steps (or, green screen, the videos behind him, his corner, "You talk in these"),
  "Same product as…" to use another format's product, Pause, Take out this format. **+ Add a format** asks the kind.
  Several of one kind are fine ("Reaction 2"). Headlines, Hook and Music below are for every format.
- **Underneath** (`batch.ts`): `BatchBank.formats` (`BatchFormat`: id, kind, name, paused, corner, voice); every clip
  says its formats (`BankFile.formats`, `BatchStep.formats`) - the clips stay in the bank's own lists, so the server
  hand-over, used clips and cut-outs work as before. `formatBank` makes one format a bank of its own (its layout, its
  sound); `batchRun.planFormats` mixes each from its own clips with the batch's headlines and music, the formats taking
  turns (`turnsFor`, counted in `formatDone`), a format with nothing left or missing a clip leaving its turns to the
  others; `leftToMake`, `missingFor`, `variationParts`, `mixPrefixes`, `recipeOf`, `recastPicks` go format by format.
  Each video's batch line carries its `format`.
- **A batch from before** becomes formats by itself (`withFormats`, the same ids on the phone and the server): green
  screen -> "Green screen" (and "Green screen - talking" for clips marked talking), otherwise "Reaction" and, for the
  clips he talks in, "Talking head", both with the product clips. The talking/not-talking lists and their slider are
  gone; the engine is still "On the engine" at the top of Formats.
- Tests: `batchFormats.test.ts`, `batchView.test.tsx`, `batchKinds.test.ts`.

## Music: each song's length, against your video's length once cut
App only: run ./deploy.sh.
**What he said (2026-11-06):** "when I choose music, it also tells me how long that music is ... my video, let's say,
is 50 seconds long, and I don't want to put music that's under that."
- The Music list (on the questions before Check captions, and in a video's row) shows each song's length - "Song name
  · 0:42" - and "(too short)" on the ones that end before the video does. Under it: "Song 0:42 · your video 0:50 once
  cut - the song ends 8 s before the video does" (in orange), or "... the song lasts the whole video".
- The video's length is what is kept after the cuts - his own cuts when he changed them, all of it for a video that
  isn't cut (`songLength.cutLength`); a video before/after isn't counted. A song's length is read from its file's
  header once and kept on the phone (`measureSong`, `useSongLengths`); a bank song not on this phone yet is never
  downloaded just to measure it - it shows its length once it has been played or used.
- Test: `songLength.test.ts`.

## Trial reels' captions in his account's own voice - and every one written before, written again
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-06):** the "hungriest I've ever been" reel's captions came out as "no words needed", "I was
starving for this one", #foodie #snacktime - "This is not the hashtag that we need. Use everything from ... the account
that those are being posted from, meaning Ziad Issa ... rewrite all these captions that have been made".
- Why: a trial's campaign ("Trial reels") has no caption rules, and the video has no talking, so Claude had only the
  words on screen and took them literally.
- Now (`postiz/index.ts` `voiceFor`, `caption.ts` `voiceRequest`): a trial's caption is written from the account it
  goes out on - his rules for that account and up to 10 captions he posted there (for Ziad Issa: the ZIADTPS
  campaign's "really short ... usually only onlinemoney and motivation ... personal brand" and its posted captions),
  with the hook read in that niche, never literally, and never a word about there being no talking.
- Every trial caption written before (`rules.voice` under `ACCOUNT_VOICE`), waiting, approved or scheduled more than
  half an hour out, is marked on the first tick after the deploy (`markTrialCaptions`) and written again, a dozen a
  tick (`rewriteMarked`); a scheduled one goes back into Postiz with the new caption at its own time.
- Tests: `caption.test.ts`. Not run here: the function itself (no Deno here) and Claude's real answer.

## Trial reels: a horizontal clip stays horizontal; the words always centred across, moved only up or down
App only: run ./deploy.sh.
**What he said (2026-11-06):** "It needs to be able to work with horizontal videos ... Right now, when I put in a
horizontal video, it automatically converts it to a 9:16 one", and "I want the text to be centered on the x-axis,
but the y-axis can be on the top or bottom ... because of the profile picture of the captions".
- A trial copy keeps its clean clip's own shape (`montageRender` `keepShape`, `montageSize`): a horizontal clip is made
  horizontal (4K -> 1920x1080, inside Instagram's 1920 across), an upright one as before. Every other batch video is
  still 9:16. The words are sized off the short side, so they fit a horizontal frame.
- `trialLoop.placesFor`: every place is centred across (x 0.5); the copies differ only in how high the words sit,
  still inside the safe band (12-68 % down). Copies already made keep their place.
- Tests: `montage.test.ts`, `trialLoop.test.ts`.

## Green screen: the cut-out starts on his iPhone; the back camera records straight from the camera
App only: run ./deploy.sh.
**What he said (2026-11-06):** "the green screen reactions just could not be made", and on the back camera the
recorder "looks very shaky, and the quality is just bad".
- **Green screen:** his report: "Something went wrong while cutting you out of the background (Cannot read
  properties of undefined (reading 'activeTexture'))" - MediaPipe made its own canvas for its graphics and Safari gave
  it none. `cutout.ts` `WorkingSegmenter` now tries, on the first real frame, the graphics chip with a canvas of the
  page's own, then the processor, then the processor with the frame as plain pixels (`SEGMENTER_WAYS`), and keeps
  the first that cuts; which one it took goes in his report (`fallback` / `cutout`). Test: `cutoutStart.test.ts`.
- **Recorder, back camera:** his reports showed every take at 24 fps with frames 2-83 ms apart, though the camera gave
  30: the picture went through the drawing canvas, which Safari records unevenly and softer. A part on a camera that
  isn't mirrored, is portrait and isn't zoomed by enlarging the picture is now recorded straight from the camera's
  own stream (`Recorder.recordsDirect`) - every frame at its time, at the camera's quality. Flipping during such a
  part ends it and starts the next on the other camera (a new clip, as after a pause). A pinch during it only uses
  the camera's own zoom. The front camera stays as it was (mirrored through the canvas).
- After opening, a camera still under 50 fps that can do 60 is asked again on its track (`applyConstraints`).
- Not checked on an iPhone: the report after a back-camera take now says "straight from the camera" and its fps.
  The camera in a web page gets no image stabilisation from iOS - if it still shakes in the hand, that is why.

## Trial reels: see every copy, approve the first 3 of each reel, and the numbers that were always 0
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-06):** "it says making 5 a day, but I don't know how it works ... There are no videos that I
can check for approval ... Nothing's happening." It was working - 10 copies of his reel were made at 04:45 UTC and
scheduled 5 a day - but the screen showed none of them, and its "today 0 out, 0 to go" was always 0: the server never
told the phone a post was a trial (`batch.trial` missing from the posts it lists).
- **The videos, on the Trial reels screen** (`TrialView` `TrialVideos`): being made (how many, how far), **To approve**
  (Watch, Approve, Reject - another copy is made in its place), **Going out** (time, words, Watch, Take out), **Out**
  (with a link to it on Instagram). The top says what a copy is and that the first 3 of each reel wait for him.
- **Approval:** copies no longer skip it (`meta.scheduled` gone for trials). Each carries its viral reel
  (`JobBatch.source`, `trialBatch(…, source)`); the server counts his yeses per reel, not per day's making
  (`postiz/batch.ts trustKey`, used by `batchHasHisYes` / `approveRestOfBatch`): approve 3 copies of a reel and
  every copy of it after - waiting now or made later - goes by itself.
- The 10 already scheduled go as they are; Take out on any he doesn't want.
- Tests: `trialView.test.tsx`, `postiz/batch.test.ts`.

## Batches: talking and not-talking reactions in the same batch, mixed at a share he sets
App only: run ./deploy.sh.
**What he said (2026-11-06):** one batch per account, with videos where he doesn't talk and videos where he talks -
"Do not mute the videos where I'm going to talk ... alternate between the two. Maybe do 65% non-talking and the
rest talking, but that's something that we could set ourselves", with product steps and green screen for both.
- The Batch tab now opens on **Your reactions**, two lists: **Not talking** (music only) and **Talking** (his voice
  kept, the music under it, dipping while he talks). Each has its own + Add; "→ Talking" / "→ Not talking" moves a
  clip from one to the other. Each clip carries `talks` (`BankFile.talks`); a clip from before follows the old
  one-for-all "Sound" switch (`batch.talksIn`), which is gone from the screen.
- With both kinds, a **Talking** slider (10-90 %, default 35 %) sets the share, and says what it means for his
  number a day ("Of your 10 a day: 7 not talking, 3 talking - taking turns"). `batch.kindsFor` picks each video's
  kind in turn, furthest behind its share first; `BatchBank.kinds` keeps the count from one top-up to the next
  (a progress field, so the server's count wins). When one kind has every video made, the other makes the rest.
  Each kind is mixed from its own reactions with the same products, steps, headlines, looks and music
  (`batchRun.pickKinds`), never the same video twice.
- **The product** (was "Layout"): After you / Behind you (green screen). Product steps now work in green screen too:
  the steps' clips play behind him one after the other (`usesSteps`, `greenScreenRender` takes several backgrounds).
- Green screen keeps his voice in a talking reaction: the background's sound drops to a quarter under it, and the
  video lasts as long as he talks - the background starting again if shorter (`greenScreenRender` `voice`,
  `voiceGain`, `UNDER_VOICE`). A not-talking green screen video is as before.
- Tests: `batchKinds.test.ts`, `batchView.test.tsx`, `batch.test.ts`.
- Not tested here: a real green screen render with his voice (this browser can't make video) - needs one real test.

## Save: a joined video gets a short name (the iPhone's share sheet choked on ~250 letters)
App only: run ./deploy.sh.
**What he said (2026-11-06):** after the last fix the Thetawave video still opened the empty preview, while his
Astrocade video saved fine. The Thetawave one is joined from 8 recordings, and its name was all of theirs - "REC
2026-11-05 22-43-08.mp4 + REC ... (8)_thetawave.mp4", about 250 letters.
- `shareFile.shareName`: what is shared is named after the first recording, how many more, and the campaign -
  "REC-2026-11-05-22-43-08+7_thetawave.mp4" - plain letters, at most 60. Test: `shareFile.test.ts`.

## Save a made video: the share sheet gets a copy in memory
App only: run ./deploy.sh.
**What he said (2026-11-06):** a Thetawave video "doesn't let me save it. I press Save, and it pops up a widget that
is like an iPhone widget that doesn't load anything."
- A made video is often kept in the Cutter's private storage; the iPhone's share sheet and its download preview
  couldn't read it from there. Now the video is copied into memory as soon as its row shows ("Getting it…" for a
  moment), and Save opens the share sheet with that copy - Save Video, AirDrop, TikTok (`shareFile.ts`
  `useSharable`, `shareVideo`). On the Videos list (`JobRow`) and in Posts (`SaveVideo`).
- The old fallback - a download link, which is what opened the empty preview on an iPhone - is only used where there
  is no share sheet at all (a computer). If the sheet still can't open, the button says "try again", and why goes in
  his report (`share`).

## Recording: 60 fps insisted on (Safari gave 30 to "ideal: 60")
App only: run ./deploy.sh.
**What he saw (2026-11-06):** after the 60 fps change the recorder still said "1080 × 1920 · 30 fps" - his report
from that build: "camera user: 1080x1920 @ 30 fps". Safari takes `frameRate: { ideal: 60 }` as a wish.
- `Recorder.open`: the camera is asked for at least 50 (ideal 60) first; a camera that can't do it refuses, and then
  it is opened as before at its best. The report now says the most the camera offers ("most 60") - so if a camera
  still gives 30, it says whether it could do more.
- Checked in the test browser, whose camera only does 20: the first ask is refused and it opens at 20 as before.

## Recording at 60 frames a second; one track plays at a time
App only: run ./deploy.sh.
**What he said (2026-11-06):** a recording "looks like it's at a lower FPS at all times ... It needs to be 60 FPS.
Why is it 30 FPS? Don't lower the quality"; and picking another song and pressing play, "the old music still goes
on".
- **60 fps** (`Recorder.cameraConstraints`): the camera is asked for 60 frames a second (it was asked for 30 - his
  reports said "camera user: 1080x1920 @ 30 fps"); the recording takes a frame for each one, and the video made from
  it keeps the same rate (`quality.frameRateOf`), at most 60 as every platform takes. Recorded at 32 Mbps at 60 fps
  (20 at 30; was 16) - `bitrateFor`. A camera that can't do 60 gives its most.
- Each part recorded now sends how evenly its frames came out (`record file`, `clipCheck.describeClip`): gaps between
  frames, frames missing or held - so a laggy start can be seen in his report, not guessed.
- His 2-minute Vertus take was drawn at a steady 30 a second, but while it was made the phone's decoder gave up once
  mid-video and the Cutter carried on from the last frame - which can show as a hitch there.
- **Music** (`TrackPlayer.PlayButton`): one track plays anywhere at a time - playing another stops the one playing at
  once (not after it loads), a track still loading when another is picked never starts, and a new pick stops it.

## The video before keeps its sound; mute it if you want; see it on the questions screen
App only: run ./deploy.sh.
**What he said (2026-11-06):** the angle's video before (his format's, e.g. Vertus) came out muted - "If the video
comes as a video with sound, then why in the hell are you muting it?" - he chooses to mute it or not; and on the
screen where he picks the headline and music he wants to see the video is included.
- **Why it was muted** (`clipParts.eachSound`): the iPhone's video decoder can't read that clip's sound
  ("InternalAudioDecoderCocoa decoding failed", his report 2026-11-04), and since 2026-11-03 such a clip played silent
  rather than losing the look. Now its sound is read with the browser's own audio decoder instead (`soundOf`, Web
  Audio `decodeAudioData` - Safari reads the same file that way), from where the first one stopped; silent only if
  neither can. A clip whose track the video decoder can't read at all is read that way too (`hasSound`).
- **Sound on / Muted** (`ClipsField`, `clips.clipMuted`/`keepClipMuted`, `JobClips.mute`, `JoinedClips.muted`): on
  each video before/after line, with its sound unless he mutes it; his choice holds for that angle's next videos.
  Made on the phone or on the Cutter server (`MakeOrder.clips.muted`).
- **▶ Watch** on each clip line plays it with its sound, and the questions screen (where it goes, headline, music -
  `CheckQuestions`) now lists the videos before/after/in the middle, to watch, change or mute.
- Test: `clipSound.test.ts` (read the other way when the first fails).

## Timeline editor straight away; out of memory starts the Cutter again by itself
App only: run ./deploy.sh.
**What he asked (2026-11-06):** "just open the timeline editor ... we click on the videos we want to put in, and we can
just edit them ourselves ... and then we can choose where it goes"; and his phone said "Something went wrong while
getting the speech model ... [wasm] RangeError: Out of memory".
- **Timeline editor** (Videos -> Other kinds of video -> Timeline editor; was "Join recordings first" - `JoinPicker`):
  pick one or more videos in order (several are put together first), then "Then it": **Post it** (nothing cut by
  itself; you edit, approve, and it goes to its campaign), **Cut the silences** (the silence cutter as usual, then the
  editor), or **Just keep it** (made, not posted - Save or Send to Postiz from its row). Remembered for next time.
  It is heard (for captions and its campaign), then opens in the timeline editor by itself. Pictures, words and other
  videos go on in the editor (+ Overlay, + Text). `CampaignApp.addOwnEdit`, the job's `ownEdit`.
- **Out of memory** (`CampaignApp`): his report - seven clips recorded in a row, then the speech model couldn't get
  memory, tried again in the same page and failed. Now an out-of-memory error starts the Cutter again by itself (once
  per video, like a stalled video) and the video carries on; and the recorder gives back its canvas and the camera's
  picture as soon as it closes.

## Recorder: a clock ring, Delete asks first, pinch to zoom; a video with no talking is a reaction
App only: run ./deploy.sh.
**What he asked (2026-11-06):** the record button with a one-minute timer going round it in red like TikTok, a little
higher; Delete (back) asks Confirm/Cancel; no limit on length; zoom; and "If you don't detect any speech ... put it
under the reaction section ... not silenced or cut at all. No need to put captions", with the headline the whole video
or only the first clip, and other words on the second, third... clip. "Clips + music, no talking" taken out.
- **Recorder** (`Recorder.tsx`): a ring around the record button fills red a minute a lap, like a clock, and goes
  round again after a minute - nothing stops at a minute (`ringFraction`). The buttons sit higher. ⌫ asks "Delete the
  last clip?" Cancel / Delete. Pinch the picture to zoom: the camera's own zoom where the phone has it, else the
  picture itself up to 4× (in the recording too); "2.0×" shows while pinching; a flip starts unzoomed.
- **Clips**: each flip while recording and each part after a pause starts a new clip; where each starts is kept with
  the video (`clipStarts`, `day.marks`).
- **No talking = a reaction** (`noTalk.ts` `noSpeechIn`, `CampaignApp.afterListen`): fewer than 3 real words heard -
  or only what the speech model makes up over other sound ("Thank you", one phrase looping) - and it goes to the
  reaction campaign his last one went to (the first otherwise, marked Needs you): kept whole (no cuts), no captions,
  no caption check (Approve on its row), the timeline editor not opened by itself.
- **Its row** (`JobRow.ReactionFields`): "The headline stays on: First clip only / Whole video" (remembered for the
  next), and "Words on clip 2 (0:04 on)", clip 3 and on - each up for its whole clip where the headline sits, in its
  look (`noTalk.clipTexts`, drawn like words typed in the edit screen). Made on the phone or on the Cutter server
  (`MakeOrder.headlineSeconds`).
- Checked in a test browser with the fake camera: the ring fills, Delete asks and Cancel keeps the clip, a recording
  with a flip and no talking came back as "Reaction, no talking" with clip 2 at the flip. Tests: `noTalk.test.ts`.

## Branded with UGC Roadmap's logo
App only: run ./deploy.sh.
**What he asked (2026-11-05):** "Brand the cutter with this UGC Roadmap logo somewhere".
- The app's icon is now UGC Roadmap's logo: the home-screen icon (`apple-touch-icon` 180 px, manifest 192/512 px,
  also maskable), and the browser tab (`public/ugc-roadmap-*.png`; the old `icon.svg`s are gone).
- The logo with "UGC Roadmap · The Cutter" at the top of More and of Sign in (`.brand-line`).
- An iPhone keeps the home-screen icon it was added with: to see the new one, remove the Cutter from the home screen
  and add it again from Safari (Share, Add to Home Screen). Nothing stored is touched.

## Caption check: the pictures pop up as in the final video; phrases said twice flagged
App only: run ./deploy.sh.
**What he asked (2026-11-05):** in the captions section "the images that are being put in when I say a word pop up
while I'm looking at the captions too, so I can also verify what the final video could look like before pressing
approve"; and "track if I repeated the same phrase twice ... flag it. Let me click on it to see, and I can delete the
first one."
- **Pictures on the check** (`CaptionReview.paintPictures`, `usePictureStills`; `CampaignApp.pictureReviewFor`): the
  angle's pictures, the bank's pictures and the logo come up on the video when their words are said, where and as
  long as the made video has them (side by side when together, the bank's newest only, popping in when the angle
  pops) - on the quick check, the timeline editor and the full caption list. Pictures he left off this video stay off.
- **Said twice** (`repeats.ts` `findRepeats`): the same run of 3+ words starting again soon after the first (up to 3
  words of a false start between) is listed above the captions - "Said twice: 'so the best way to' · 0:12 · watch".
  Tapping it plays it; **Cut the first** cuts from the first try to where the second begins (`CutsControl.cut`, undo
  works), and the captions follow. Only flagged: nothing is cut unless he taps.
- Checked in a test browser with a recording of the same speech said again: the repeat was listed, Cut the first took
  it out and the list updated. Tests: `repeats.test.ts`.

## Talking videos on the Cutter server: listened to and made several at once
Ships with ./deploy.sh; the Railway server updates itself from the push.
**What he asked (2026-11-04):** "I paste in all my talking heads, and it takes 5 minutes ... If the videos could be
edited on the server, meaning that they can be listened to and everything is on the server, and then they get them
back to me so I can just check the captions ... if it's only under 3 videos, then just make it on the phone".
- With 3 or more videos waiting to be listened to and his server up, they go to the server: sent up one after another
  ("Sending it to the server"), listened to there 4 at once ("On the server · Listening"), and back on the phone
  sorted, with the headline written, for him to check exactly as before. Approved, each is made on the server (2 at
  once) and sent to Postiz from there ("Made on the server · on its way to Postiz") - the phone is free meanwhile.
- 1 or 2 videos, no server, or any trouble with it: the phone does them itself, as before.
- Measured here on a 4-core machine with five 61 s 1080p videos: listening all five took about 30 s at once (26 s
  for one alone); making is bound by the server's cores (about 23 s a video on 4 cores).
- Tested end to end here: the real server program with Chrome for Testing, and the app in a test browser - 3 videos
  sent, listened to on the server, back for Check captions, approved, made on the server; and the fallback when the
  server fails.
- Files: `talkOrder.ts`, `talkLink.ts`, `serverTalk.ts`, `CampaignApp` (`talkTick`, `afterListen`, `makeOrderFor`,
  `backToPhone`, the job's `onServer`), `server/main.mjs` (`/talk`, `/local/talk`). AGENTS.md rule 4: his talking
  recordings may go to his own Cutter server (his OK, 2026-11-04).
- Not on the server yet: reactions, montages, joins, formats, Edit again; a video made there can't be edited again
  from Posts.

## Stop a video being made or joined
App only: run ./deploy.sh.
**What he asked (2026-11-04):** "an option to cancel a video that's currently being joined together or ... being made
... I approve without wanting to, and it just takes up my whole phone for a couple minutes".
- `JobRow.tsx`: a **Stop** button beside the progress bar of the video being worked on (Videos list).
- `CampaignApp.stopJob`: the video goes back to how it was before he approved it (to check again); stopped while being
  joined or listened to, it is left alone (`store.holdJob`) until he taps Start or Remove. The Cutter then starts again
  by itself (`restartPage`) - the only way to take the phone's video maker off the work at once; every other video is
  picked up where it was.

## Headlines written from the whole video; changing the campaign keeps your headline
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-11-04):** "Stop automatically putting the headline as the first line ... take a sort of summary
of the whole video and make a headline about it that's going to grab people's attention. Take as an example my previous
headlines." And: moving a made video to the right campaign "resets the headline" he had typed.
- **Claude writes the headline** (`postiz/videoHeadline.ts`, action `video-headline`; phone `posting.videoHeadline`):
  for an angle set to write its own headline (Editors: "Write it from the video", was "Make it from my first line"),
  once a video has been listened to Claude gets everything he says in it and his past headlines (each once, most
  viewed first) and writes one hook about what the video is really about, in their style - only what the video says,
  at most 12 words. No signal or no answer in 30 s: his first line, as before. He still sees it and can change it.
- **Changing the campaign keeps his headline** (`CampaignApp.chooseFor`): a headline he typed (`headlineMine`) stays
  exactly as he wrote it, even after the app is closed and opened; one Claude wrote stays for an angle that writes its
  own; only otherwise does the new angle's headline come in.
- Tests: `videoHeadline.test.ts`.

## Videos: no more Today / Next days - the next days by themselves; weekends ticked
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-11-04):** "remove the 'post for the next days' option. Just do it automatically", and in New
post "Weekends auto ticked".
- `CampaignApp.tsx`: the Today / Next days switch above the videos is gone.
- `postiz/slots.ts` `pickTime`: a day holds as many videos as the campaign has times that day. Today's free times are
  taken first; once today has that many (on its times, or late ones spread over the evening), the next video takes the
  next free time from tomorrow on, by itself - it used to be squeezed in today as an "extra". A campaign's most a day
  still caps every day on top of that (`toDayWithRoom`). Tests in `slots.test.ts`.
- `NewPost.tsx`: Include weekends starts ticked; unticking it is remembered.

## New post: "10 videos - how many a day?" and Include weekends
App only: run ./deploy.sh.
**What he asked (2026-11-04):** dropping many videos for one campaign, "it simply asks me ... you have 10 videos ...
post 2 per day, post 1 per day?" and spreads them over the next days; and "Include weekends" - checked, weekends post
too.
- `NewPost.tsx`: with several videos and Spread them, it asks "N videos - how many a day?" (1 a day up to the campaign's
  most, at most 5; never more than the campaign allows) and has an Include weekends tick. The line under it says the
  days, e.g. "5 days: Today 2 · Tomorrow 2 · Fri 1". His answers are remembered (how many a day per campaign, weekends
  for all), so next time it is already picked. A note that says how many a day picks for him.
- `handPlan.ts`: `chosenPerDay` (counting what the campaign already has that day) and `weekends` (false skips Saturday
  and Sunday). Weekends start off unticked, as he described it. Tests in `handPlan.test.ts`.
## Trial reels: a viral reel made again and again, posted as Instagram Trial Reels
Needs deploying: run ./deploy-server.sh (the `postiz` and `cutter` functions), then ./deploy.sh.
**What he asked (2026-11-04):** take reels that went viral, send the raw clip and the viral one, and have the app
put the same text back - moved, or a word or two changed, sometimes a touch brighter or darker - and post 30 a day
as Trial Reels to his personal brand. Easy to start (2 seconds), change the number a day, Stop and start a new one.
For him and Ilian only, not Stefan. Never shown to followers. His answers: one account, light changes, same words +
rewordings, never share to followers, learn Instagram's daily limit, a still of the reel may go to Claude.
- **How to use it:** More -> Trial reels (only shown to a login allowed it). Pick the viral reel and its clean clip
  together, tap Start. The first time the app makes a "Trial reels" campaign on your Instagram account (it asks which
  one only if you have several). Videos a day with −5 / +5, Stop on one reel, Stop everything.
- **Who has it:** the owner's login (and the admin backup) always; another login when the owner taps Turn on in
  Settings -> People. The server checks it on every request (`postiz/trial.ts trialAllowed`, cutter `trial`,
  `cutter_config` `trial-reels`); a trial video from any other login is refused, never posted as a normal Reel.
- **What happens:** `viralReel.ts` finds where the viral reel starts (matches the clean clip's first frame - a screen
  recording can open on Instagram's screen), takes its sound from there, and one still goes to Claude (`trial-read`)
  for the words, their look (box / outline / Snapchat, outline colour, size), place and 12 rewordings of a word or two.
  `trialLoop.ts` is a batch of layout `trial`: half the videos his exact words somewhere else, half a rewording; 5
  brightness steps; every combination once before any again, then it starts over - it never runs out. The batch
  machinery does the rest (`batchRun` top-ups, even times around the clock, trims when the number drops, the Cutter
  server when connected). Made by `montageRender` with `brightness` and `keepLines` (the words stay on the viral
  reel's lines, a little smaller rather than wrap).
- **Posting:** each goes with `meta.scheduled` (no approval) and `batch.trial`; `settingsFor` sends Instagram
  `is_trial_reel: true, graduation_strategy: 'MANUAL'` - Postiz passes both to Meta (checked in Postiz's source,
  2026-11-03). Never handed to Buffer (it would post a normal Reel).
- **Instagram's limits:** when Meta turns a trial down for its daily limit (2207078), the server counts the trials
  that went out on that account in the 24 h before, keeps it in `settings.trial.limits`, tells him once, and the loop
  makes no more than that (`BatchBank.most`). An account that can't post trials (2207081) is kept in
  `settings.trial.notAllowed`: the loop stops and says why, until a trial goes through.
- **Checked here:** vitest (trialLoop, trialView, postiz/trial), tsc, lint, build, the functions with `deno check`.
  A real render in Chrome for Testing: the start of a screen-recorded reel found at 1.0 s, its sound taken from there,
  copies made with the words moved, reworded, brighter and darker, on one line. **Not checked:** an iPhone, Claude
  reading a real reel (no key here), Instagram taking the trials - one real test needed.

## New post reads your note for when, and no campaign ever goes past its most a day
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-11-04):** writing "I already posted today. Post it for tomorrow" in New post's "Anything Claude
should know", the videos still went today - Claude read it only for the captions. And five videos pasted for Cantina
(1 a day at most) must never make more than 1 a day; the same from Videos.
- **The note is read before anything goes** (`NewPost.tsx` `noteFor`): tapping Post straight from the box used to send
  before Claude had read it (it was read only on leaving the box). Now Post waits for Claude ("Claude is reading your
  note…") and plans the days with what it says. One reading per wording, shared with leaving the box.
- **"I already posted today"** (`postiz/handNote.ts` `alreadyToday`): Claude also says how many he says he posted today
  himself, and they count against today's most a day; "post it for tomorrow" / "not today" start tomorrow.
- **The campaign's most a day holds even for videos sent together** (`postiz/dayRoom.ts`, `toDayWithRoom`): each video
  being scheduled writes its time down first, then counts the day - scheduled and posted ones, and of those being
  scheduled at the same moment only the ones that came first. Five sent at once used to each find the day empty and
  all go on it. This is the server's last word for every post - New post, Videos, batches.
- Tests: `dayRoom.test.ts`, `handNote.test.ts`.
## Research: Instagram Trial Reels and Meta's originality rules
Nothing to deploy - a document only, no code changed.
**What he asked (2026-11-04):** an admins-only feature for Trial Reels and Meta's rules on reposted videos - research first.
- `docs/TRIAL_REELS_AND_ORIGINALITY.md`: what Trial Reels are and who can use them, that Postiz already posts them
  (`is_trial_reel`, `graduation_strategy`), that no API moves a trial to followers, Meta's 2025-2026 originality rules,
  ranked ideas for the Cutter, how an owner-only switch fits the login rules, and the questions for him.

## Recording: no more laggy takes
App only: run ./deploy.sh.
**What he said (2026-11-04):** some takes in the Cutter's recorder came out "super, super, super laggy" - a perfect
take he had to throw away.
- **Why** (`Recorder.tsx`): the camera was asked for 4K and every picture shrunk onto the 1080x1920 recording - four
  times the pixels, for no sharper a video. And the picture was drawn at the screen's rate while the recording took
  frames on a 30-a-second clock of its own: the two drifted against each other, so frames came out twice or were
  missed, worse as the phone warmed up on long takes.
- **Now:** the camera opens at Full HD, exactly the recording's size, and each new camera frame is drawn once as it
  arrives (`requestVideoFrameCallback`); the recording takes one frame per drawing - one per camera frame, nothing
  doubled or dropped. Phones without frame callbacks draw as before.
- Each part over 3 s sends a `check` / `record` report: frames drawn, how many a second, how many slow, camera size -
  so a laggy take can be read from his report.
- Checked in the test browser with a fake camera: one frame drawn per camera frame, recording on through a flip.

## No more dead noise at the cuts
App only: run ./deploy.sh.
**What he said (2026-11-04):** "Every single time there's a cut, there's a little noise ... that little dead noise
... it's ruining every single video."
- **Why it happened** (`render.ts`): each kept part took whole chunks of sound (about 21 ms each) and silenced what a
  chunk held from outside the part; the part was then lined up with its picture, which usually ran a frame longer, and
  the file filled that with silence. At every cut his room went fully silent for 20-60 ms - the dead moment he hears.
- **Now** (`cutFades.ts` `VoiceJoin`): each part's sound is cut to the exact sample at its edges, the next part follows
  on with no hole, and at a cut the two overlap for 12 ms, one fading out as the other fades in at equal loudness (like
  an editor's crossfade). Where a video joined on comes next, or at the end, his sound fades out and silence fills to
  the end of the picture - never a hole for the file to fill. Each part still starts where its picture starts.
- Tests: `voiceJoin.test.ts` - read in real 1024-frame chunks across cuts, the room tone stays at the same level all
  the way through (no window of 5 ms drops), and the stream has no gaps. The plain cutter is unchanged.

## A joined clip whose sound won't decode plays silent, instead of losing the look
App only: run ./deploy.sh.
**What he saw (2026-11-03):** "Plain cut. The look couldn't be added. InternalAudioDecoderCocoa decoding failed."
- His report: the recording itself decoded fine twice (listening and the plain cut), and the look failed twice within
  two seconds of starting - where the video joined before it starts playing. The iPhone's audio decoder couldn't read
  that clip's sound, and that one clip took the whole look down to the plain cut.
- `clipParts.eachSound`: a clip whose sound the phone can't decode now plays silent (picture as usual) and the video
  is made with the headline, logo and the rest; one `fallback` / `clip sound` report says so. Test:
  `clipSound.test.ts`.

## Videos: "From tomorrow" is now "Next days"
App only: run ./deploy.sh.
**What he said (2026-11-03):** "'from tomorrow' makes no sense. You could have 'today' and 'for the next days'".
- `CampaignApp.tsx`: the switch above the videos reads Today / Next days, and its line says what it does - nothing
  goes out today, each video takes its campaign's next free time, tomorrow and the days after; back to Today by itself
  the next day. Nothing about how it works changed.

## Recording: the selfie camera's video comes out mirrored, as on screen
App only: run ./deploy.sh.
**What he asked (2026-11-03):** the recording "I want you to mirror it so it feels natural, exactly like on TikTok".
- `Recorder.tsx`: with the front camera the picture was mirrored on screen but the video came out the other way round.
  Now the recording is mirrored too (drawn flipped onto the recording canvas), so the video looks exactly as he saw
  himself while filming. The back camera is never mirrored. A flip changes it only once the other camera shows.

## Snapchat headline: a little smaller, slimmer bar
App only: run ./deploy.sh.
**What he said (2026-11-03):** the Snapchat look "feels a little uncanny, and it's just a tiny bit too big. Make it a
little bit smaller".
- `overlay.ts`: the words about 14% smaller (Medium 4.3% of the width, as Snapchat's own caption on an iPhone), lines
  a little closer and the black bar a little thinner around them. Outline and Box are unchanged.

## Recording: flipping never stops the recording; a much brighter selfie light
App only: run ./deploy.sh.
**What he said (2026-11-03):** the light "has to be more like white"; and "when I flip ... it pauses the video. The
video needs to keep going ... it kind of does mini cuts, and the video sounds less good after that."
- **Flip without a break** (`Recorder.tsx`): the microphone stays open the whole time and what is recorded is the
  camera's picture drawn frame by frame onto a 1080x1920 canvas (`captureStream`) - the size every finished video is
  made at. A flip only changes the camera behind it (the old one closed first - an iPhone runs one at a time; the
  last picture held meanwhile, never black). One part, no join, no cut in the sound. Pausing still makes parts (⌫).
- **Selfie light:** with the light on and the front camera, the picture is a small window and the rest of the screen
  pure white, the buttons light too - several times the white there was.

## Claude + X: under the logos an amount, one of the headlines, or nothing
App only: run ./deploy.sh. Nothing stored is touched: banks, clips and settings stay as they are (no storage change).
**What he asked (2026-11-03):** the Claude + X hook "can also just have some headlines. It can just be two pictures,
and it doesn't necessarily have to be an amount a day".
- Batch tab, Claude + X: **Under the logos: Amount a day / Headlines / Nothing** (`BatchFormula.says`, absent =
  amount as before). Headlines: each video takes one of the batch's headlines under the logos, at the headline's size
  (`batch.formulaHooks` - one hook per headline; `formula.plain`; `layoutFormula(..., plain)`); the Headlines box
  shows for it. Nothing: just the two logos and the plus (`layoutFormula` lays out no line for an empty one). The
  caption is told "Claude + OpenArt - <headline>" or "Claude + OpenArt" (`formulaText`). The preview shows it.

## Batches: text is optional - no headline, no words on the videos
App only: run ./deploy.sh.
**What he asked (2026-11-03):** "there always has to be some sort of text ... sometimes you have to add an empty space
box. Sometimes it just makes it weird and kills the reach" - text optional on any batch.
- A batch no longer needs a headline to start (`batchRun.missingFor`); with none, its videos are made with no words
  on them (`batch.headlinesToMix`: one blank stand-in, so the reactions, products and songs still go round evenly -
  green screen too). A blank headline draws nothing (it never did: a space was dropped as no headline, so Start
  stayed shut). The Headlines box says "Optional". Step names were already optional ("Step 1" draws nothing).

## Batches: the campaign's effects only; talking batches; New post keeps the campaign's most a day; the note to Claude schedules too
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too). The Cutter servers rebuild by themselves.
**What he asked (2026-11-03):** "if a campaign says no effects, then there's not going to be any effects ... It
should be the single source of truth"; "some talking batches and some reaction-only batches" (a friend's batch
"muted every single sound. It just put some music on"); New post dropping 14 videos "divide them from today to the
next days, depending on how many posts are allowed per day on that campaign"; and the "Anything Claude should know"
box for scheduling ("2 per day for the next 14 days") and caption rules - the campaign first.
1. **Effects:** a batch video takes its campaign's effects and nothing else - Settings' default effects no longer
   fill in (`CampaignApp` `defaults: null` for `montage.bank`), and the batch's own slow push-ins (the reaction's
   zoom, the Claude + X push) come only with the campaign's push-in on (`montageRender` `pushes`). No effects in the
   campaign: none at all. Videos already made keep what they have.
2. **Talking batches:** Batch tab, **Sound: Music only / My voice + music** (`BatchBank.voice`). With voice, the
   reaction's own sound is kept and the music goes under it, dipping while he talks (`montageRender` `voice`:
   `onSound` of the first clip into a buffer, `musicTrack(..., voice)` with a limiter, `MusicBed` under a voice at
   -20 LUFS, the sound written 1.5 s behind the picture). The product clips stay muted. Not in green screen or on
   the engine yet.
3. **New post, several videos:** with Spread or All now, each video gets its own day and time
   (`handPlan.ts` `planHandDays`): never more on a day than the campaign's most a day, counting what it already has;
   today's room first (from a quarter of an hour on), then the next days, evenly over the campaign's window; All now:
   today's room now. The plan shows above Post ("2 a day at most (Vertus): Today 1 · Tomorrow 2 · ...").
4. **The note to Claude:** read when he leaves the box (`read-note`, `handNote.ts`): how many a day, from which day,
   for how many days - that plans the days as above, under the campaign's most - and the rest of the note goes to the
   captions. The caption prompt now says the campaign's rules come first and his note second (`caption.ts`).

## Recording like TikTok: record and pause in parts, ⌫ takes off the last part, ✓ to the timeline editor
App only: run ./deploy.sh.
**What he asked (2026-11-03):** "When you press it again, the video doesn't end. It keeps going. Once you press that
check on the right, it brings you to the timeline editor"; and after a stutter, "undo the last clip, and then
re-record it, but don't delete the whole thing".
- The red button records and pauses, again and again; each part shows on a bar along the top (a minute across,
  longer as the video grows). **⌫** (left of the button) takes off only the last part; **✓** (right) finishes. Flip
  moved up beside the light. (`Recorder.tsx` `lengths`, `deleteLast`)
- After ✓ the parts are joined into one video, cut and captioned as always, and when it is ready the **timeline
  editor opens on it by itself** (`CampaignApp` `editorWanted`, `EditScreen` `startFull`) - only while he is on
  Videos with nothing else open; otherwise it waits in the list as usual.
- A recording is never asked "This video isn't 9:16" - it is always cut (`addFiles` `recorded`).

## Record in the Cutter: its own camera, tap to record, double tap to flip, a light, takes joined
App only: run ./deploy.sh.
**What he asked (2026-11-03):** iPhone's "Take Video" in the picker looks pixelated (it is iPhone's own small
camera for web pages, recording at reduced quality); build the recorder, highest quality.
- Videos -> **Record a video** opens `Recorder.tsx`: the camera full screen; the red button records and stops; a
  double tap anywhere (or ⟲) flips front/back - mid-take, that take ends and the next starts on the other camera;
  several takes, then **Done · N**. One take goes on as a picked video does (`addFiles`), several are joined first
  (`addJoined`). ✕ asks before throwing takes away. The timer shows the whole video across takes.
- **Quality:** the camera is asked for 4K at 30 fps (`cameraConstraints`) and gives the most it can; what it gave
  shows at the top ("2160×3840 · 30 fps") and is sent as a `check`/`record` report, so the real numbers from his
  iPhone can be read. Recorded as MP4 at 16 / 28 / 45 Mbps by size (`bitrateFor`), mic without the phone's own
  noise suppression (the Cutter does its own). The screen stays awake while recording (Wake Lock).
- **Light ⚡︎:** front camera - the screen around the picture turns white (TikTok's selfie light; brightness all the
  way up makes it brightest); back camera - the flashlight, where Safari allows it.
- Checked here with Chrome's fake camera: opens at 4K, records, flips mid-take, Done with 2 takes makes one joined
  video in the list. Nothing here can run the iPhone's camera.

## Timeline editor: smooth scrolling, pinch to zoom, exact trims, undo/redo arrows, centre lines, full screen
App only: run ./deploy.sh.
**What he said (2026-11-02):** "very laggy", "when I zoom in, sometimes it just zooms in on the whole screen", "I have
to press a button, and I can't actually zoom in inside of the timeline", "sometimes it trims too much or it doesn't
trim enough", "Undo should be in arrows only", text and overlays "need to be centered" with "a little line", and
full-screen preview. (`CutsEditor.tsx`)
- **Smoother:** scrolling asks the video for the nearest frame it can show at once (`fastSeek`) and the exact one
  140 ms after the finger stops (`scrub`); the timer, what is drawn over the video and the captions follow each frame
  directly, and the rest of the screen catches up when he stops (`followTime`) - no whole-screen redraw per frame.
- **Pinch the timeline to zoom:** while the fingers move the timeline is only stretched (`scaleX`, smooth), laid out
  at the new zoom when they let go; the − / + buttons are gone. A pinch anywhere else on the editor does nothing - the
  whole page used to zoom (iPhone Safari ignores the page's "no zoom").
- **Exact trims:** the edge keeps the distance from where the finger landed on it (it jumped to the finger's middle,
  ~0.25 s at the usual zoom), and snaps to a gap between words only within 4 px (was 10 px).
- **Undo ↶ and redo ↷ arrows** at the top, for the cuts and for words and pictures put on, moved, changed or taken
  off (`past`/`future` snapshots, 50 deep). The Undo button is gone.
- **Centre lines:** words, pictures, videos and the headline snap onto the middle across and down when near it, a
  yellow line showing (`CENTER_SNAP`, `guides`).
- **Full screen** (⤢ at the top, in the quick check too): the video fills the screen and plays as it will post; ✕
  closes it.
- Not yet: muting a video's own sound or a video put over it - the render leaves those silent today; next, with
  recording.

## Quick caption check: only what needs a look, one card at a time; then Approve or the timeline editor
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too).
**What he asked (2026-11-02):** "I want you to find a way to check the captions quicker, so I can just say, 'Okay,
good, good, good, next'" - no scrolling every phrase with the keyboard up; ready -> approve and send; not ready ->
"Go to timeline editor".
- Check now opens on the **quick check** (`EditScreen` `quick`, `CutsEditor` `quick`, `CaptionReview` `QuickCheck`):
  the video with its captions, Claude's read running by itself, then a card for each phrase to look at - its moment
  shown on the video, **Good** (on to the next, which plays), **Undo change** (back to what was heard) when Claude
  changed it, **Fix** (a box for that phrase only - the keyboard only then). At the bottom, **Approve & next** and
  **Timeline editor** (the same video, the cuts' timeline and everything else, no reload). Nothing to look at:
  "Every caption looks right".
- **Claude now says what it couldn't be sure of** (`recheck.ts` `unsure`, `cleanUnsure`; effort high). Once it has
  read them, the cards are only what it changed, what it is unsure of, and a campaign name heard nearly right - the
  cutter's own unsure moments no longer add cards (Claude judged those). The cards stay put while he fixes one.

## Reaction videos: pick the headline's look (White box, Outline, Snapchat)
App only: run ./deploy.sh.
**What he asked (2026-11-02):** in Videos, a reaction video's headline in Snapchat text or Outline or the box.
Under the headline box on Videos -> Reaction video, once a headline is written: White box / Outline / Snapchat
(`JobRow.HeadlineLook`). Every reaction added after takes it (`day.headlineStyle`, the per-video look the edit
screen already had, read by the render), and the pick is remembered per campaign on the phone
(`cutter.reactionLook`). Nothing picked: the angle's own look, as before.

## Simpler to find your way: five tabs, Posts its own tab, fewer buttons at once; Analytics fits the screen
App only: run ./deploy.sh.
**What he asked (2026-11-02):** "it's very confusing because there are like a million different types of things,
buttons" - look at it as someone who has never used it, keep everything it can do; and Analytics overflowed to the right.
- **Five tabs instead of seven:** Videos · Posts · Batch · Analytics · More (`TabBar.tsx`). Posts is a tab now, with a
  red count of posts to approve; More (`MoreView.tsx`) holds Campaigns, Formats, Bank and Settings - each with
  "‹ More" back - and Cut only, the plain cutter (the Cut only / Campaign videos switch that sat on top of every
  screen is gone from this page; the plain cutter keeps its own way back, unchanged). `tab === 'posts'` replaces the
  old Posts screen; everything that opened Posts (a notification, `#posts`, Edit again's Cancel) goes to the tab.
- **Videos:** the Posts card shows only when something is still going up or can't; "The videos you add now post:
  Today / From tomorrow"; the other kinds of video as buttons under "Other kinds of video".
- **Posts:** one "All campaigns · 84" box instead of a button for every campaign; + New post in the header. Each
  post: Approve (or Brand approved), Post now, Watch, Reject - and "More options" for post later, change time, music,
  save video, edit again and a different caption for one platform.
- **A campaign:** Stop all its posts, End campaign and Delete folded under "Stop or end this campaign".
- **Batch:** "Set order" is "Product steps"; "Reaction + video".
- **Overflow:** a long headline or clip name in What works widened the page (a one-line name in a grid row that could
  grow); rows can't grow past the screen now, and headers, the hook looks and trouble rows wrap. Checked at 390, 375,
  360 and 320 px on every tab and every screen under More.

## A warning when an account stops getting views; new headlines like the best
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too).
**What he picked (2026-11-01):** 2 and 4 of the ideas list.
1. **Account in trouble (most often a shadowban).** Once a day the tick compares each account's videos from the last
   3-7 days (read at three days) with its usual - videos 8-35 days old (read at a week) - by their middle number of
   views (`postiz/deadAccounts.ts` `deadAccounts`): at least 4 and 8 videos, usually 100+ views, now under a quarter
   of that. He gets a notification ("lovable.zi on TikTok may be shadowbanned", at most once a week per account) and
   Analytics shows it at the top with Pause / Resume (the existing per-account pause, `posting.pauseAccount`). Kept in
   `cutter_config` `dead:<profile>`; the `insights` reply carries `trouble`. Nothing pauses by itself. On Nov 1's
   data no account was flagged.
2. **Write more like the best** (What works, under Headlines): Claude writes 8 headlines in the style of the
   campaign's best, steering away from the worst, none it already has, no new claims (`postiz/headlineIdeas.ts`,
   action `headline-ideas`, his Anthropic key); each one goes into the batch's headlines with a tap
   (`AnalyticsView.addHeadline`). Nothing is added without his tap.

## More at the best hours, by day of the week; what works, as graphs; Use the best hooks
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too). The Cutter servers rebuild by themselves.
**What he asked (2026-11-01):** "a higher rate at certain hours, depending on the day of the week ... I still want it
to be spread evenly around the clock, but just have a higher rate concentrated around the hour that has the most
views" - not back to back, "it's going to flag it"; and "very, very tracking-oriented, with a very visible graph of
the best hooks", with a button that "makes a higher percentage of using those hooks".
1. **When to post** (top of Analytics): a week of hours, darker where more of the day's videos go, today's best hours
   in words, tap an hour for its number, Turn off/on. The server works it out once a day from every video's views
   (`postiz/bestHours.ts` `learnHours`: videos 3-35 days old, each over its campaign's usual so a strong campaign
   doesn't make its hours look good, each hour of the week leaning on the same hour of the other days and the hours
   beside it; nothing until 150 videos are in - his had 241 on Nov 1, a gentle 0.8x-1.4x so far). Kept in
   `cutter_config` `hours:<profile>`, sent with the profile (`bestHours`). A day's batch times are evenly apart in the
   hours' weight (`window.ts` `evenTimes` with `hours`, `weightScale`): up to twice the day's usual at its best hours,
   at least half at its weakest, every hour still posting, and never closer than 8 minutes while the day allows
   (`LEAST_EVEN_GAP`, `usableHours`). Used by `posting.batchTimesOn`/`stackTimesOn` (`hoursHere`), the server's
   respread (`planRespread` `hours`) and `evenAlready` (judged in the weight), so `keepEven` moves days already
   scheduled (not yet in Postiz) onto them. Actions `insights`, `best-hours {off}`.
2. **What works** (each batch campaign in Analytics): bars of views a video for its headlines, reactions, songs and
   headline looks, best first, the best (★ Best, green) and worst (red) marked, from batch videos 3-30 days old
   (`postiz/hookInsights.ts`: each thing's number leans on the campaign's average, 3 videos' worth, so one lucky video
   isn't "best"). The reaction is read from the video's name (all old videos count); the song is carried with each
   video from now on (`JobBatch.song`, `batch.song` on the server).
3. **Use the best hooks**: one tap; the ★ Best headlines, looks, reactions and songs go into twice as many of the new
   videos (`batch.ts` `favour`, `useBest`, `FAVOUR`; `pickBatch` counts each use of one as a half), and it follows
   the numbers by itself each time they are read (`batchFavour.followFavour`, in `CampaignApp`). Each different video
   is still made only once. "Back to even" turns it off.
UI: `WhatWorks.tsx` (`BestHoursCard`, `WhatWorks`), `AnalyticsView.tsx`.

## Approve 3 of a batch and the rest of it goes by itself
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too).
**What he picked (2026-11-01):** "approve the first 3, the rest go by themselves". He watches 3 videos of each
batch in To approve; his third yes approves every other video of that batch still waiting, and any made for it
later goes straight through too. Ones he turned down, held with Post later or that have no caption yet don't count
and aren't approved. Posts says "The other N of this batch are approved too." and shows them scheduled; the
campaign's row says "Approve 3 and the rest of the batch goes by itself."
Underneath: `batch.ts` `BATCH_TRUST` (3) and `batchTrusted(statuses)` (approved, scheduled, posted, error count as
his yes); `postiz/index.ts` `batchHasHisYes`, `approveRestOfBatch` after the `approve` action (reply
`alsoApproved`), and `prepare` approves a batch video on arrival when its batch already has 3 yeses. The scheduler
puts them into Postiz 12 h before their times as for any approved batch video. Phone: `postAction` passes
`alsoApproved` on; `PostsView` reloads the list then. A video remade after a rejection is a new small batch and
still waits for him.

## A rejected batch video is made again; a notification when the Cutter server stops
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too). The Cutter servers on Railway rebuild by
themselves from this push.
**What he picked (2026-11-01):** 1 and 2 of the next list.
1. **Reject in To approve makes another.** Rejecting a batch video there now marks it (`batch.disliked`, the `reject`
   action's `disliked`), and the batch counts it out of its day (`batchRun.dislikedBy` in `runSlots`), so a
   different mix is made for that day. The day's "too many" trim leaves the new one alone (`overfull` and
   `trimPlan` take the same count; the saved count stays every video made). A stop, an edit (Edit again) or a new
   version (music) rejects too but is not made again. The Reject question says so.
2. **The Cutter server is watched.** Every 10 minutes it says "still here" to the login function (`server-ping`,
   kept as `server:<space>:<profile>`), with whether its page is going, its free disk and whether it is signed in.
   The posting function's tick (`watchServers`, `serverWatch.ts`) tells him once when it goes quiet for 30 minutes,
   its page stops, its disk is under 0.5 GB, or it is signed out - and once when it is right again. Each server
   (his, his friend's) to its own posting profile.
Tests: `batchDisliked.test.ts`, `serverWatch.test.ts`.

## Most posts a day per campaign, YouTube through Buffer in the evening, a morning summary
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too).
**What he picked (2026-11-01):** from the list of what to add next - 1, 2 and 3.
1. **Most posts a day, per campaign.** Each campaign's Posting has "Most posts a day" (the brand's limit; empty = none),
   kept with his accounts and times (`settings.campaigns[id].mostPerDay`, `save-campaign`). A post whose day already
   holds that many of the campaign's posts (scheduled, out, or approved for that day) goes to the first day with
   room at the same time, and says so ("Vertus: 2 a day - moved to Sat 11:00 AM.") - over every account, a TikTok
   shared with another campaign too (`schedule` -> `toDayWithRoom`, `campaignOnDay`). **Set for Vertus: 2** (by hand,
   his ask of 2026-10-30).
2. **YouTube through Buffer.** A YouTube account with a Buffer YouTube channel of the same name is now matched
   (`buffer.ts` `matchChannels`), and a YouTube copy due from 3 PM California on goes through Buffer at its own
   time (Buffer has its own YouTube limit) with a title (`youtubeTitle`, category People & Blogs). Buffer turning
   it down, or no such channel: the next day's good hours as before. **He has to connect the YouTube channels in
   Buffer** (free plan: 3 channels). Buffer's YouTube fields (`metadata.youtube.title/categoryId`) could not be
   checked against its docs from here (developers.buffer.com blocked) - the fallback covers a refusal. The Buffer
   screen says which YouTube channels it posts.
3. **A morning summary** at 9 AM his time: "Yesterday: 61 posted, 2 missed" and each miss with what is being done,
   then each campaign with a most a day ("Vertus 2/2") (`summary.ts`, `dailySummary`, once a day per profile -
   `cutter_config` `summary:<profile>`).
Tests: `summary.test.ts`, `buffer.test.ts`.

## Batch tab: "Stop and take out the N scheduled" beside Stop
**What he chose (2026-11-01):** Stop stays as it is (nothing more made, what is scheduled keeps posting) and a second
button beside it also takes out every one of the batch's posts not out yet - of the Cutter and of Postiz, the way
Posts' Select then Stop does. It asks first, says how many, and says how many came out (`BatchView.stopEverything`,
`BatchStatus` `stopAll`; test `batchStatusStop.test.tsx`).

## Fix: a campaign's batch videos never two at the same moment
Needs deploying: run ./deploy-server.sh (server only).
**What he said (2026-11-01):** his friend's Playad "kept posting even when he stopped it", even after removing posts
in Postiz by hand.
**What the database shows:** no Playad post was ever stopped in the Cutter. On 2026-10-25 his friend's phone and his
new Cutter server (restarting on storage errors) made Playad batches four times over within two hours, and on Oct 31
four Playad videos went out at 3:51 AM and four more at 6:04 AM. With all of a campaign's own times that day taken,
the server let the next video go at its own time anyway - the same minute as the others - so removing one copy in
Postiz left three. (The Batch tab's Stop only stops making videos - "the ones in Posts keep their times" - and the
Cutter hands each batch video to Postiz 12 h before its time, so ones removed in Postiz are followed by the next.)
**Now:** with every time taken, a batch video goes at the nearest free quarter hour that day, at least 10 minutes from
any other video of its campaign (`batch.ts` `freeBatchTimes`, in `takeBatchSlot`). Nothing duplicated is scheduled
now (checked).

## Sign-in links: tied to the person's phones, you told of each one, Pause and Remove
Needs deploying: run ./deploy.sh (it runs ./deploy-server.sh too). The table `cutter_devices` is applied
(migration `20261030120000_cutter_devices.sql`, under his "do whatever you want for the database").
**What he asked (2026-10-30):** if the person shares their login secretly, "Am I going to know? ... Will he even be
able to do it?" - "Add all the protection." (The first one: Stefan.)
**Now, for every login made with a link (not his own):**
- **At most 3 phones at once.** Each sign-in names the phone (an id it keeps) and the login works only there; a
  phone's Safari and the Cutter on its Home Screen count as two, so 3 is one phone both ways and one more. A 4th is
  refused: "This login is on 3 phones already. Ask Ziad to take one off."
- **He is told:** a notification on his phone when the person opens their link, signs in on a new phone, or is
  refused a 4th.
- **Settings, People** shows each login's phones ("iPhone · Home Screen app, since Oct 30 · in use now"), **Remove**
  on a phone (signed out at once, its place free) and **Pause** on the login (every phone refused, nothing deleted;
  **Let go** to undo).
- A copied token from another phone doesn't work there either: the phone's id is in it and checked on every call
  (both functions). What no software stops: handing over the unlocked phone itself.
- `cutter/invite.ts` (`MAX_DEVICES`, `deviceFrom`, `roomForDevice`), `cutter/index.ts` (`onDevice`, `notifyOwner`,
  `pause`, `removeDevice`, token `d`), `postiz/index.ts` `spaceFor`; phone `cloud.thisDevice/deviceName/pauseLogin/
  removeDevice`, `People.tsx`. Tests: `invite.test.ts`, `cloudDevice.test.ts`.

## YouTube no longer sent when its daily limit is used up - and spread over the day
Needs deploying: run ./deploy-server.sh (server only - no Netlify needed).
**What happened (2026-10-30):** Postiz again: "Error posting on youtube for MikeyAi - YouTube's daily upload quota is
exhausted for today, please reschedule this post for a later time." Every evening, YouTube copies failed: the limit
is Postiz's, shared, used up from the afternoon in California, and starts over at midnight there. His words: "schedule
the Vaza and the Vertus videos, separate them throughout the day, but only the ones on YouTube ... this is making me
lose at least $50 per day."
**Now:**
- A post whose time is from 3 PM California (6 PM Toronto) to midnight there sends its **YouTube copy the next day,
  8 AM to 4 PM Toronto** (5 AM to 1 PM California) - the evening's 9 hours laid over those 8, so the order and
  spacing stay - and at least 45 minutes from that account's other YouTube posts. The other accounts go at the
  post's own time. The post says "YouTube goes Fri 9:39 AM - its daily limit is used up in the evening."
- A YouTube copy that fails anyway is posted again once in the next good hours (not at 3 AM any more).
- **Data, by hand (2026-10-30):** the 7 VAZA (Vazaziad) and Vertus (MikeyAi) posts that missed YouTube since
  Oct 27 are queued to go to YouTube today 8:10 AM to 1:10 PM Toronto, the two accounts taking turns, 1 h 40 apart
  each (`retry_at`; the live server's `retryMissing` posts them).
- `failed.ts` `youtubeTime`, `youtubeRetryTime`, `clearOfTaken`, `goodHoursEnd`; `index.ts` `schedule` (one Postiz
  post per group, each part's ids saved as made so a retry never makes one twice; `youtubeTaken`), `missedFields`;
  the YouTube ref keeps its time (`at`) so `checkPosted` looks for it then.

## A one-time sign-in link for someone new, with their own Cutter
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself) - after the migration
`20261029120000_cutter_invites.sql` is applied (shown to him first).
**What he asked (2026-10-29):** give a new person access - "We're going to send him a link ... automatic sign-in ...
a one-time login. After that link gets clicked once, it's not valid anymore." His answers: his own space ("I want
him to keep his data"), the link dead after 48 hours, and he sets a password so he can sign in again himself.
**How to use it:** Settings, **People** (only on the main login): type his login name, **Make link**, **Send** (the
phone's share sheet: WhatsApp, Messages). He opens it, chooses a password, and is in his own Cutter, empty -
nothing of yours. The link then stops working; one never opened stops after 48 h (make a new one with the same
name). People lists each login and whether its link was opened.
**Underneath:** cutter function `invite` (main login only) / `accept-invite` / `people`; `invite.ts`
(`cleanLoginName`, `isActive`, `songPrefix`); only the code's SHA-256 is stored, cleared on use in the one update
that signs him up. Invited or paused logins can't sign in or post (both functions). The music bank was shared by
every login: each login now has its own (his stays as it is). The phone doesn't send anything it holds to the new
login (a link opened on a phone with someone's setups). AGENTS.md hard rule 1 now names this as the only way a
login is made. Tests: `invite.test.ts`, `loginGate.test.tsx`. Not tried against the live server here.

## Music: stops with the song outside batches; change it or take it off after approving
**What he asked (2026-10-29):** "Let's say we have a song, and it completely ends. Don't loop it at all. Just stop
it right there ... for all the talking head videos, but for the batches, make sure they keep replaying"; and "I
already approved it, and then I realize, I don't want that music, or maybe I want to change the music."
**Now:**
- **A song shorter than the video stops where the song ends** (a short ease out, no click) in talking-head videos,
  reaction videos and music added from Posts to a video that isn't a batch's. **Batch videos (montage, green screen)
  still loop it**, and music added to a batch video from Posts loops too. `MusicBed`'s new `loop`.
- **Change music / Take the music off** on a post waiting, approved or scheduled for later: a talking video made
  with music now keeps its sound without the music beside the copy waiting to be posted (`musicFree.ts`, about 1 MB
  a minute, in the phone's private files, gone with the copy). The Posts screen's music button then says **Change
  music**: the new song goes under that sound instead of on top of the old one; **Take the music off** sends it with
  no music. The picture is copied, not made again - seconds. Sent as a new version, the old one taken back, as "Add
  music" always did. Videos made before this, and batch videos made by the server, still only get "Add music" (on
  top) - Edit again (2 h) changes a talking video's music as before.
- `music.ts` (`loop`), `render.ts` / `reactionRender.ts` (no loop; `voiceOnly` written), `musicFree.ts`,
  `outbox.keepVoiceOnly/voiceOnly`, `addMusic.addMusicTo(video, music | null, ..., loop, voice)`,
  `musicAfterSend` (`canChangeMusic`), `MusicAfter` (`useCanChangeMusic`). Test in `music.test.ts`. The new sound
  file and Change music were not tried on an iPhone (no AAC encoder in this container's browsers).

## Claude checks the captions by meaning, with what the video is about, by itself
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-10-29):** when he talks to Claude, it understands everything because it knows the context;
the captions should get the same - "the captions getting transcribed and then an AI looking at the actual logic of
the captions". The re-check only fixed spellings, and only when he tapped it.
**What was wrong:** Claude was told "fix spelling only" and given only the brand's words; anything more than a few
letters' change was thrown away after (`acceptFix`). It never knew what the campaign or the video was about.
**Now:**
- **It knows what the video is for:** the campaign, the brand as it is written, the brand's caption rules (what it
  is and does), the angle, the headline on screen, and how the campaign's last 5 posts were described - plus the
  whole video's captions, as before.
- **It fixes by meaning:** a word that sounds like what he said but makes no sense there is put back ("I use
  virtues" to "I use Vertus", "go by it" to "go buy it", "twenty case" to "20K"). Still never rewords what he really
  said; a change of more than a word or two is still turned down.
- **It runs by itself** the first time a video's captions open (once a video on this phone); "Check again with
  Claude" runs it again. What it changed is highlighted, with Undo. A phrase he types into while it checks stays
  his. About 1-3 cents a video (his Anthropic key).
- Server `recheck.ts` (`RECHECK_SYSTEM`, `acceptFix`, `cleanContext`, `recheckMessage`), `index.ts`
  `recheckCaptions`; phone `posting.recheckCaptions`, `CampaignApp.recheckContextFor`, `CaptionReview`
  (`recheckKey`, `wasChecked`). Tests: `recheck.test.ts`, `captionRecheck.test.tsx`. Not tried against Claude here.

## The Posts screen: one row per campaign, day by day, and every video can be watched
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-10-29):** the scheduling section is badly organized - a Loveable zi post from Tuesday with "The
caption couldn't be given the hashtags (Postiz said: Post not found)" first every time; Lovable Steve 9 videos,
Lovable Zi 23, Lovable Zi 24, Lovable Steve 11 as separate rows ("one that shows every single post that Lovable
Steve has scheduled, that I can open or close", "similar to a calendar"); watching a post says it isn't available
("what's the point of making me approve them if I can't even see the post? I only want to see 3 posts at the
start of every single batch").
**Now:**
- **One row per campaign** in To approve, Ready to post and Scheduled, whatever batches made them ("Lovable Steve ·
  20 videos · Today to Sat, Oct 31 · next 3:15 PM"). Opened: every post, **day by day** under Today / Tomorrow /
  the date. His own posts waiting for him stay one by one (each caption is read).
- **To approve shows the first 3 of each campaign open, with the video playing**, and **Approve all N** for that
  campaign; "Show the other N" for the rest.
- **Every video can be watched:** a batch video waits on the server until 12 h before its time (made by the
  Cutter server, so not on the phone) and Postiz didn't have it yet - nothing to play. The list now gives the
  server's own copy until Postiz has one, and the server answers the partial reads Safari's player needs.
- **The Tuesday post:** Postiz had lost it ("Post not found"), so it never went out and stayed Scheduled, first in
  the list, for 3 days. A scheduled post Postiz no longer has, an hour past its time, is now marked **Not posted**
  with a notification; Post again sends it now.
- `postsList.ts` `foldCampaigns`, `byDay`; `PostsView` `BatchRow` (preview, Approve all, Days); server `watchLink`,
  `range.ts` `byteRange`, `checkPosted`. Tests in `postsList.test.ts`, `postsView.test.tsx`, `range.test.ts`.

## Post now, beside Approve
A post waiting for him has **Post now** next to Approve (his choice, 2026-10-29, over making Approve itself post
at once): approved and sent to Postiz to go out straight away, whatever time it had. Underneath it is Approve with
a time of now (`at`), which the posting function already sends as Postiz's "post now". Approve still goes at its
time. Phone only - no server change.

## Missed YouTube posts go again by themselves; a notification for every missed account
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he said (2026-10-29):** YouTube misses some accounts; "Post again to the missing ones" just says "Trying" and
gives the same button back, so he posts them by hand; "notify me whenever a post does not work - I'm not always
going to know that I lose money".
**What was found:**
- **Why YouTube fails:** of 14 days' YouTube posts, almost none failed between 7 AM and 3 PM Pacific, and half to
  all failed from 4 PM to midnight Pacific. YouTube's daily upload limit starts over at midnight Pacific: it runs
  out through the evening, not his accounts. Reconnecting doesn't help that.
- **Why the button did nothing:** his two taps (2026-10-29 03:51 UTC) were refused with "Postiz says too many
  requests right now" (Postiz's hour was used up), and that message showed at the top of the Posts list, out of
  sight. The reconnect fix of the same day wasn't deployed yet either.
**Now:**
- **A YouTube account missed is posted to again by itself** at 12:10 AM Pacific (3:10 AM in Toronto), once. The
  post says "Posting again at 3:10 AM, when YouTube's daily limit starts over." If it fails again, it's his: a
  notification says so.
- **Post again never just fails on a busy Postiz:** the tap is kept and it goes by itself as soon as Postiz has room
  ("Posting again as soon as Postiz has room."). Anything else a tap comes back with shows under that post.
- **A notification for every video that misses an account** ("VAZA: missed an account - Not posted to
  Vazaziad. ..."), not only for ones that missed all of them; also through Buffer, for ones Postiz never confirmed,
  and when posting again by itself still fails.
- `failed.ts` `youtubeDayStarts`, `baseNote`; `index.ts` `missedFields`, `postAgainSoon`, `retryMissing`;
  `PostsView` per-post problem. Tests in `failed.test.ts`. Posts that already missed YouTube before this are
  left to him.

## A YouTube account that won't post: reconnect it in Postiz, tap once, it posts
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-10-29):** sometimes a video doesn't go to some YouTube accounts. He disconnects and reconnects
the account in Postiz, then taps the button on the missed accounts in the Cutter, and it should post again at once.
**What was wrong:** reconnecting gives the account a new id in Postiz (Vazaziad: `cmv6t2ks...` became `cmvq3z8h...`
on 2026-10-27), and disconnecting takes its failed posts out of Postiz. "Post again to the missing ones" still
posted to the old id, or said "Postiz no longer says which account it failed on". It also waited 3 minutes.
**Now:** on a post that missed accounts, the Posts screen has **Reconnect in Postiz** (opens Postiz) next to **Post
again to the missing ones**. After reconnecting, that tap:
- finds each missed account, under its new id if it has one (same platform and username), and posts to it **now**;
- puts the new account into every campaign that had the old one, and into the videos not in Postiz yet, so the
  next videos go to it too (videos already in Postiz stay as Postiz holds them);
- if a missed account still isn't connected (or Postiz says it needs reconnecting), posts nothing and says
  "<name> needs reconnecting in Postiz - reconnect, then tap again".
- `failed.ts` `missingAccounts`, `namesIn`, `reconnectedAs` (tests in `failed.test.ts`); `index.ts` `retryAccounts`,
  `useReconnected`. Not tried against Postiz itself (it can't be reached from here).

## A post waiting for your OK moves on when its time goes by
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-10-27):** "If the time passes, it should reschedule it. If there's time on the day before
midnight, reschedule it for an hour later, and keep rescheduling it for an hour later until we hit midnight, but then
reschedule it for the morning after."
**Now:** a post still waiting to be approved (by him or the brand) whose time has gone is moved an hour later by the
posting function's tick (every 5 minutes), and again each hour; the hour that would pass midnight goes to 9 the next
morning instead, keeping its minute (6:17 PM ... 11:17 PM, then 9:17 AM). Approved, it goes at the time it shows. A
batch video's day moves with it, so it counts on the day it really posts (a minute on if another of the campaign's
holds that time). Before, it stayed at its old time and took the next free time only when approved.
- "The morning after" is 9 AM - nothing he said fixed the hour; the Posting settings' approval hints say so.
- `slots.ts` `laterWhileWaiting` (tests in `slots.test.ts`, across the clock change too), `index.ts` `moveOnWaiting`.

## Fix: stopped videos left in Postiz when its hour was used up
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
Taking a stopped video out of Postiz counted "Postiz's hour is used up" (`PostizWait` - Postiz not even asked) as a
failed try: after six ticks it gave up with "Couldn't take it out of Postiz ... - delete it there". 143 of his
friend's stopped videos (2026-10-26, evening) stayed in Postiz and would still go out. Waiting for the hour no
longer counts (`unpostStopped`), and the rest of that run waits too.

## Batch videos wait in the Cutter until half a day before their time
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What happened (2026-10-27, midnight):** the server made the new seventh day's videos and each went straight into
Postiz (upload + post: two of its 30 requests an hour), and the even-spacing kept taking scheduled videos out of
Postiz and putting them back (two more each). His own post (Grubby Ai) got "too many requests" - his words: "only
schedule the ones that are necessary for the day", "now I can't even post anything anymore".
**Now:**
- **A batch video goes into Postiz 12 hours before its time** (`BATCH_LEAD_MS` in the posting function's
  `schedule`), not when it is made: until then it waits, approved and ready, with its video on the server. So
  Postiz gets a steady few an hour around the clock - however many days are made at once. One that may be in
  Postiz already (`creating_at`, Buffer) goes on as before.
- **Batch videos may use 20 of Postiz's ~28 requests an hour** (`POSTIZ_BATCH`, need `'batch'`): the rest is kept
  for his own posts. When only the batch's share is used, his posts still go (`postizBusy` keeps the two apart).
- **The even-spacing never takes a video out of Postiz** (`respread.ts`: `scheduled` is no longer movable, and a
  day with one in Postiz is left as it is). It moves only the videos still waiting in the Cutter - free - and
  those are worked out again for their new time. Its hourly pacing (`RESPREAD_PER_HOUR`) is gone with it.
- **The batch makes 3 days ahead, not 7** (`AHEAD_DAYS`): the server makes them day and night ("you don't need to
  create the videos for next month"). Days already made further ahead stay.
- The ~380 videos already scheduled in Postiz stay where they are - taking them out would only cost requests.

## Up to 48 a day, growing fast: a campaign's last week
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What he asked (2026-10-26):** a campaign ending in about a week with budget left - "today and tomorrow ... at least 25
... tomorrow 30 ... after tomorrow 50 on both accounts ... and that's it", "slowly up it, but up it aggressively".
**How to use it:** Batch tab, each campaign: Videos a day 30, More each day 10 - 30 today, 40 tomorrow, then 48 every
day. The server tops up every day of the week ahead at once: each day's new videos go between the ones it has.
- **48 a day is the most** (`batchRun.MOST_A_DAY`, in `perDayOn`): Instagram takes at most 50 posts an account in
  any 24 hours from an app and refuses the rest, and each video goes to every account of its campaign. Growth used
  to have no most. Videos a day stops at 48 and says why.
- **More each day** goes to 25 (was 5) and can be typed, like Videos a day.
- **A topped-up day is left as it is** (`respread.evenAlready`, now also what the phone's `keepEven` checks): every
  gap between a third and twice the average one counts as even enough. A day going from 29 to 48 has its videos 15
  to 55 minutes apart; moving them all to exact even times would take each one out of Postiz and put it back -
  some 1,300 requests for this week, two days of Postiz's hourly limit, holding up the new videos. A day badly
  lopsided (squeezed into 11 to 5, two on top of each other) is still moved.

## Fix: the soonest videos get Postiz's hour first, so none goes out late
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
One of his videos due at 22:45 UTC went past its time still out of Postiz (it takes the next free time, nothing
lost). Postiz's hour went to videos days off: the Posts screen's nudge (3 stuck posts each time it is read, every
minute on the Cutter server) took the newest made first, and a post refused many times waited a flat half hour
and came due after the hour had opened and filled. Now the nudge takes the soonest first, like the scheduler, and
skips a login whose Postiz is busy; and every "too many" post is tried again the moment its Postiz hour is out.

## Fix: his friend's videos stuck out of Postiz all day; even days no longer moved again
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What happened (2026-10-26):** his friend's 80 videos taken out by the respread sat out of Postiz all afternoon
with his Postiz hour free. Three things together:
- A video Postiz couldn't take far ahead, on an account Buffer backs up, is parked until a few hours before its
  time - and the new hourly count (`PostizWait`, "this hour's share is used") parked it the same way, for hours.
  Now `PostizWait` on a video more than an hour off goes to `failed()` and is tried again when the hour is out
  (no try spent). Parking is left for Postiz being down.
- The half-hourly "ask Postiz again" for parked videos (`probePostiz`) went by the parked videos' last change - and
  the respread changed them on every go, so it never asked. It keeps its own note now (`probe:<login>` in
  `cutter_config`).
- One login's Postiz hour running out stopped the scheduler for every login (`postizBusyUntil` was one for all).
  It is per login now (`postizBusy`); the tick looks at up to 60 due posts and tries 10 of the logins not waiting.
**The respread moved what was already even (`respread.ts` `evenAlready`):** worked out afresh each time, the rest of
today shifted a little with every go, and so did every new day the batch made (its even times differ from the
respread's own) - each one in Postiz taken out and put back for nothing. A day whose videos are already evenly
apart (every gap within 40% of their average, and today's not bunched up in what is left of it; a whole day's
last-to-first gap counts) is now left as it is. The parked 80 were put back to be tried at once by hand
(`retry_at`), with his friend's hour free.

## Postiz's 30 requests an hour, shared out: posting first
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What happened (2026-10-26, 06:00-14:00 UTC):** after the respread took videos out, only 60 of about 470 went back
into Postiz in 8 hours. The scheduler runs every 5 minutes and, each time, read Postiz (what went out, views) and
retried a refused post - and Postiz counts the questions it turns away too, so both accounts stayed at "too many
requests" all morning. Nothing was lost or went out late (posts due were put in when a request got through, or
parked until a few hours before their time).
**Now (`postizAllowance` in the posting function):** every Postiz request is counted per Postiz key, by the hour, in
`cutter_config` (`postiz-use:<hash of the key>` - never the key). Reads - checking what went out, views - may use
12 of the 30; putting videos in and taking them out the rest (28). After Postiz says "too many", nothing is asked
of it until its hour is out (at least 15 minutes), instead of a refused question every 5 minutes. A post that
waits for that (`PostizWait`) spends no try, so it never goes back to "To approve" for it. Should the counting fail,
Postiz is asked anyway.

## Fix: videos taken out of Postiz by the respread go back in soonest first
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
Before the pacing above was live, his phone's respread took 245 scheduled videos out of Postiz while Postiz,
at its 30 requests an hour, turned the putting back in away ("too many requests"). They wait as approved and are
tried again every 15 minutes (then every half hour); one still out at its time takes the next free time - none is
lost, but the soonest must get in first.
- The tick tries due posts soonest first (`post_at`, was oldest change first), and stops for the run at Postiz's
  first "too many" (`postizBusyUntil`, 5 minutes) instead of spending ten tries a minute being turned away.
- The respread takes nothing more out of Postiz while more than 3 of the login's batch videos are waiting to go
  back in, or while Postiz is busy.

## Spreading what is scheduled: paced to Postiz's 30 requests an hour
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself).
**What happened (2026-10-26):** the first run moved 20 of his videos in a minute, then Postiz answered "too many
requests" - it lets an account make 30 requests an hour (its docs), and moving a scheduled video takes two (out,
back in). Nothing was lost: the 31 taken out wait as approved and go back in by themselves as Postiz allows, hours
before their times; the rest stay at their old times until moved.
**Now:** `respreadBatches` takes at most 6 scheduled videos out an hour per login (`RESPREAD_PER_HOUR`, 12 requests,
counted in `cutter_config` `respread:<profile>`), so new videos still get into Postiz, and stops for the hour at the
first "too many requests". Videos not in Postiz yet (waiting, approved) still move at once - they cost nothing.
Soonest first, so each day is done well before it comes. The phone and the Cutter server ask again every half hour
(`keepEven`), so it finishes by itself with the app closed; the phone says how many moved and how many follow.

## Spreading what is scheduled: the Cutter server does it too
Only ./deploy.sh is needed; each Railway server rebuilds by itself.
He asked why the phone had to stay open about 10 minutes while a few hundred scheduled videos were moved to
their even times. `keepEven` now runs on the Cutter server's page as well (it was left out in `SERVER_MODE`):
the server is open day and night, so the moving carries on with the phone closed, and later uneven days are put
right there too. Both running at once is harmless: the posting function moves each video once (it claims it).

## Batches post around the clock, evenly - and what is already scheduled is moved to match
Needs deploying: run ./deploy-server.sh (./deploy.sh runs it by itself when it sees the posting function changed).
**Why (2026-10-26, his words):** "Why is it that posts only happen between 11 am and 5 pm? ... One day I'm going to
do 125 posts a day ... They have to be compressed by a 24-hour period. Always has to be posting." And: "If it's 2
posts, 10 posts, or 50, it all has to be evenly separated", "I don't want them to always be in the same minute",
"change the already scheduled posts ... I'm not doing that manually". Most campaigns' posting windows were 11 AM -
6 PM (the old default, written in by "Random times for every campaign"), and a batch drew its times from it.
**Now:**
- A batch's times ignore the window: `window.evenTimes` spreads them evenly over the whole day - one every
  24 h / n, the row moved a quarter to three quarters of a step each day (so the minutes change), each nudged up to
  a tenth of a step, never on a minute ending in 0 or 5. Across midnight the gap stays half to one and a half steps.
  `posting.batchTimesOn` uses it; his own fixed times stay, the rest placed where the day's whole number would
  sit evenly, farthest from his (`stackTimesOn`, which also places videos added to a day that has some).
- The server keeps an even time to the minute: `batch.batchJitter` gives the usual 0-9 minutes only to round
  times (his own), so 125 a day 11 minutes apart don't come out 2 minutes apart.
- What is already scheduled: the posting function's new `respread-batches` (`respread.ts` `planRespread`, tested):
  for each campaign and day from today, the videos not out yet are put at the day's even times - today, over
  what is left of it after 20 minutes; posted ones and ones due in 20 minutes stay. A video waiting for approval
  just gets its time; one scheduled comes out of Buffer, then Postiz, and goes back in at its new time with the
  video Postiz already has - no approving again, no upload. Under a minute a call, soonest first.
- The phone does it by itself (`keepEven.ts`, from `CampaignApp` when the app is open, every half hour): once for
  everything after this update, then for any campaign whose coming days came out uneven (`unevenCampaigns`), at
  most hourly. It says "Spread N scheduled videos evenly over the whole day."
- Batch tab: "Spread over the whole day, different times each day - today ..."; the campaign line says "around
  the clock". The window still sets when New post's posts go.
Checked: unit tests for the even times, the plan (a day squeezed into 11-5 comes out evenly over 24 h; the same plan
twice moves nothing; today only the rest of the day) and the uneven-day check; the posting function type-checks
with Deno as before (its one old error unchanged). Not run against Postiz from here: watch the first round's notice
and the posts' new times in Posts.

## Apple's emoji: kept that way for everyone
Only ./deploy.sh is needed; the Railway servers rebuild by themselves.
After his friend's batch videos came out with Google's emoji, three guards so it doesn't happen to anyone again:
- Any iPhone (or Mac) with a server sends the pictures of a headline's emoji before the headline itself reaches
  the server - checked by a test that has the clip upload, the emoji picture and the bank in that order
  (`serverLink.test.ts`). The server's videos wait for the pictures it has been sent (`headlineFontReady`).
- A server about to draw an emoji it has no picture for reports it, once per emoji (`emojiSprites.checkPictures`,
  a `check`/`emoji` report naming the emoji and the headline) - seen in the reports before it is seen in posts.
- A test fails if any headline line in `overlay.ts` is drawn without `drawLine` (the one way the pictures are used).

## The server's videos have Apple's emoji, not Google's ("Samsung emojis")
`./deploy.sh` for the phones; each Railway server rebuilds by itself.
**What happened (his friend's posts, 2026-10-25):** the Cutter server draws the headlines in Chrome on Linux, which
has only Google's emoji, so the batch videos it made showed them instead of the iPhone's. Apple's emoji font can't be
put on a Linux server.
**Now:** the iPhone draws each emoji of the batch's headlines and step names as a picture, with its own font, as it
always drew them in his videos (`emojiSprites.ts`: `drawEmoji` - cut to its ink, with its advance and where it sits
from the baseline, in ems). They are kept with the bank (`bank.emojis`, bank files named `emoji-<code points>`) and
go up with the clips (`serverLink.withEmojis`, `bankFiles`). The server's page loads them (`serverMode`;
`headlineFontReady` waits for them before a video is made) and `overlay.ts` draws each picture where its emoji goes
(`drawLine`, `measureLine`; an outline goes round the words only, as on the iPhone). The server keeps them like the
clips (`main.mjs` `bankFileIds`). A phone draws its own emoji as before; only an iPhone's (or a Mac's) pictures are
sent. Checked in Chrome here: a headline drawn from pictures made this way lands on the same size, height and place
as the same headline drawn normally. Not seen on a real iPhone + server yet: new emoji only reach the server the next
time the phone opens the app with signal.

## Fix: the server's Chrome started and quit every 5 seconds ("chrome stopped 21")
Nothing to deploy with ./deploy.sh: each Railway server rebuilds by itself from this push.
**What happened (2026-10-25, his server's log):** `chrome started` / `chrome stopped 21` every 5 seconds. Exit 21 is
Chrome's "profile in use". A deploy restarts the container and stops Chrome hard, and Chrome's lock file
(`SingletonLock`, naming the old container) stayed on the volume; every Chrome after it took the profile as in use
by another machine and quit at once. Reproduced here with Chrome for Testing: exit 21 with such a lock.
**Now:** `startChrome` removes `SingletonLock`, `SingletonSocket` and `SingletonCookie` before it starts Chrome -
only this server runs Chrome on that volume, and never two at once - and the same Chrome then starts and runs. A
Chrome that still quits right after starting waits longer each time (10 s, 20 s, 40 s ... up to 5 minutes), and the
log says so, instead of starting every 5 seconds.

## Fix: "The server went quiet" while the phone was only sending clips
Only ./deploy.sh is needed.
**What happened (2026-10-25):** after his server's disk was made new, the phone sent every clip up again - many
minutes - and the Batch card said "The server went quiet - nothing from it for 12 min". The server was fine: the
phone asks how the server is doing once per round of sending (`serverLink.linkOnce`), and that round was still
sending clips, so the last answer it had grew old.
**Now:** while a round is still sending, each 30 s tick asks the server's status anyway, and the status keeps when
the phone asked (`askedAt`). "Went quiet" is measured from that question - the server's page silent for 10 minutes
at the moment it was asked - never from the phone not asking.

## Batch card: "Stopped" says the made videos still go out
Only ./deploy.sh is needed.
A stopped batch's card said **Stopped**, and he read it as his 18 videos for today being stopped. It now says **Not
making new videos** - "The 18 already made still go out at their times. Tap Start below to make more."

## Fix: ./deploy.sh failed on the Mac ("differs ... only in casing")
Only ./deploy.sh is needed.
The Batch tab's new card had its logic in `batchStatus.ts` beside `BatchStatus.tsx`. A Mac's disk doesn't tell
capitals apart, so `./BatchStatus` found the logic file and the build stopped - nothing was shipped. The logic is
`batchNow.ts` now, and `caseNames.test.ts` fails the checks whenever two of the app's files (tests aside) differ
only in capitals, so it is caught here, before his Mac.

## Batch tab: one card at the top says what the batch is doing
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Why (2026-10-25, his words):** "the UI is disgusting on the batch, so we don't even know if posts are being made
or not." What the batch was doing was six grey lines under every setting, at the very bottom of the tab.
**Now:** a card right under the campaign picker (`BatchStatus.tsx`, its logic in `batchNow.ts`):
- One headline with a dot: **Making videos** (green), **Up to date** (green), **About to make more**, **Paused**,
  **Not making new videos** (grey), or what is wrong in red - the server out of reach or out of room, **The server went
  quiet** (no word from it for 10 minutes while the batch runs), or **N couldn't be made**. Where: on the server,
  this phone or the engine.
- **Now:** the video being made and how far it is (the server now reports its progress, and how many failed).
- How many more are waiting, and **Last video ready N min ago** - the newest of the batch's videos in Posts.
- **Next 7 days:** each day's count ready of its number (green when full), and a bar - gone out (green), ready
  in Posts (blue), being made (grey). On this phone a failed video no longer counts as being made.
- Server checked in N ago, and the GB free. **Stop** is in the card.
The old lines ("Next 7 days: X of Y", "On the server now", "Made through", the phone's "Making 3 of 6" bar) are
gone; the "Makes the next 7 days now" line stays under Start while the batch is stopped.

## Cutter server: says when Railway's plan is too small, and keeps its disk for what matters
Nothing to deploy with ./deploy.sh for the server (it rebuilds by itself on Railway); `./deploy.sh` brings the
phone's side (the warning in Settings and the Batch tab).
**What happened (his friend's server, 2026-10-25):** "the volume is 98% full in the first minute", then "the
deploy crashed". The server's reports: `QuotaExceededError Encountered full disk`, `FILE_ERROR_NO_SPACE`,
`Failed to write blobs` - the disk was full as soon as the clips went up, and videos couldn't be kept to send.
His Railway is most likely on the free plan: 0.5 GB of disk and 0.5 GB of memory, too small for Chrome making
1080x1920 videos.
**Now:**
- `/connect` and `/status` give the disk's size and the memory the server may use (`room` in `server/main.mjs`,
  from the volume and the container's cgroup). `serverLink.roomProblem` turns that into one line: under 1 GB of
  either is "Railway's free plan - take Hobby, then a 5 GB volume"; under 0.5 GB free is "almost full". Settings,
  Server shows it in red instead of "Connected", and the Batch tab's server line too.
- Chrome's own cache goes to the container's disk, capped at 64 MB (`--disk-cache-dir`, `--disk-cache-size`), not
  the volume, and the clips the page reads are `no-store`: Chrome no longer keeps a second copy of each one.
- Chrome that can't start (missing, out of memory) is tried again, instead of taking the whole server down with
  it; an unhandled failure is logged, never a crash.
- A tall iPhone clip is made H.264 at most 1620 across (`TALL_WIDTH` in `readable`): the videos are 1080 across,
  zoomed in up to 1.45 times, so that keeps every pixel. Kept at 4K, H.264 at that quality took 2-4 times the
  iPhone's own file - a 3 s 4K test clip: 27 MB as HEVC, 168 MB as 4K H.264, 67 MB at 1620 - and a bank of them
  filled the disk. It is twice as fast too. Wide clips keep their full size (9:16 is cut from their height).
- The page's check after each start no longer says "this phone can't read 4K iPhone video" on the server: it
  makes iPhone video H.264 with ffmpeg and writes sound with its own encoder, so those two checks are the phone's
  only.

## Cutter server: its log says which version it runs
Nothing to deploy with ./deploy.sh; each Railway server rebuilds by itself.
The server's first log line now reads `for the phone on :8080 - version <commit> (<service name>)`, the same
version `/health` gives. With two servers (his and his friend's), Deploy Logs then show at once whether one missed
an update - his friend's had auto deploy off and stayed on an old build.

## Railway: the Cutter server builds with nothing to set
Nothing to deploy with ./deploy.sh. On Railway, each server rebuilds by itself from this push.
**What happened (2026-10-25, his two servers):** both Railway addresses showed the Cutter app itself (its sign-in)
instead of the server. Railway no longer lets a new service use a config file ("Config as Code is deprecated ...
services that have never used Config as Code cannot opt in"), so the "Config file path" `/server/railway.json`
step did nothing, and Railway built the repo as a plain website.
**Now:** the server's image is the `Dockerfile` at the top of the repo (moved from `server/Dockerfile`), which
Railway uses by itself. `server/railway.json` stays, pointing at that same `Dockerfile`, for a service that took
it as its config file before Railway closed that (his friend's shows "Config as Code is deprecated"): it keeps
working until 2026-12-01 and builds the same server. The server also answers the phone on 8080 when Railway's
own `PORT` is another, so the address made with port 8080 always reaches it. A working server's `/health` is one
line of text, `{"ok":true,...}` (`server/README.md` says how to tell).

## Fix: Stop now stops the batch, and the hook buttons work while it is making
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What happened (his friend, 2026-10-24):** Stop only stopped the next days from being planned. A top-up queues up
to a week of videos at once, so after Stop the phone went on making every one already queued, video after video:
"it never wants to stop". And every button of "How each hook is doing" ("Change to...", "Stop using it", "Change
words") and Start over were greyed out while any video of the campaign was being made - with a batch running, that
is all the time, so they never worked.
**Now:** Stop takes the videos waiting to be made out of the queue at once (`batchRun.stopBatch`: as a hand-over
does it - their mixes freed, the days counted again from what is left). Videos already in Posts keep their times;
the one being made that minute is finished. A batch stopped on an older version with videos still waiting shows
"Stop the N waiting to be made". The hook card's buttons and Start over work while the batch is making: a tap
waits for a top-up that is running (`batchRun.nextInLine`, instead of `oneAtATime`, which dropped it), then reads
the jobs as of the next draw so the ones that top-up queued are included. The video being made at that moment is
finished as it was, and the message says so. "Drop a hook that does badly by itself" is no longer skipped while
the batch is making either.

## Fix: "How each hook is doing" and "Change to..." missing on a batch with no look picked
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What happened (his friend, 2026-10-24):** on a batch where no headline look was ever picked in the Batch tab, the
videos use the angle's own look but none of them recorded it, so the card had no line per look - nothing to "Change
to..." from. Those videos now count as the angle's look (`batchHooks.assumedLook(bank, angleLook)`, given
`angle.headline.style` by BatchView), so the look line shows with its "Change to..." chips as soon as one of its
videos is still to go out. The card is far down the tab: a "Change a look on the videos not out yet ↓" link under the
batch's status line jumps to it.
**Also:** the hook card's sums and the weak-hook check were React hooks placed after the tab's early returns
(no posting profile / no campaign), so a tab that went from one of those to the batch could crash with "rendered
more hooks". They are plain sums on each draw now, and the weak-hook check runs from a small `WhenChanged`
component.

## Fix: a post made with "Pick a time", then given music, vanished - and posting it again showed nothing
Only ./deploy.sh is needed; then close the Cutter and open it again. Post the video again from New post: it goes.
**What happened (Lock in, 2026-10-24):** a video posted from New post at a picked time (tomorrow 3:53 PM) was given
music three times. Each version with music lost the picked time and went to the campaign's next time (today 3:19
PM), and each took the one before it out of Postiz the moment it was queued - before it had even been uploaded. The
last one never arrived, so nothing was left anywhere. Posting the video again from New post then made the same
post key as the first one (same video, campaign and day); the server handed back that rejected post, and nothing
showed.
**Now:**
- Music on a post made by hand keeps the time he picked for it (and it still needs no approving).
- The old version (music added, or Edit again) comes out only once the new one is on the server. If the new one
  can't get there (no signal, app closed), the old one stays until it does. One due within 15 minutes still comes
  out at once, as before, so both can't go out.
- A video posted again from New post after its post of today was rejected is a new post, with a key of its own.
**How:** `SendEntry.replaces` + `outbox.retireReplaced` (after `sent`, and again on each run for any left over),
`outbox.replaceNow`, `musicAfterSend` (`byHand` with the post's own time, `replaces`), `CampaignApp.retireOld`
(returns the key to replace later), `NewPost` (`~anew-` key when today's post with its key was rejected).
Tests: `musicAfterSend.test.ts`, `outboxReplace.test.ts`, `newPost.test.tsx`.

## Updates install by themselves, even with a batch running
Only ./deploy.sh is needed. This one still arrives the old way (the "Update now" line at the top of the screen, or
closing and opening the Cutter); every update after it installs by itself.
**What was wrong:** a new version only loaded once nothing at all was waiting to be made. A batch tops itself up, so
on a phone with a batch running that moment never came: his friend's phone stayed behind, with an "Update now" line
at the top of a screen he had scrolled away from. (His friend's iPhone also has two Cutters - the home-screen one, up
to date, and one in a Safari tab that was days behind; they don't share anything on an iPhone.)
**Now:** once a new version has downloaded, the batch starts no new video; when the one being made is done, the
Cutter starts again into the new version - the same safe restart it does after a stall: never while he types, edits
or goes through a screen, only once what is being kept and sent is saved - and the batch carries on where it was.
A line at the top says so meanwhile. The plain cutter keeps its "Update now".
**How:** `UpdateBanner` (`UPDATE_READY_EVENT`, `updateDownloaded`, `handled`), `CampaignApp` (`updateWaiting` holds
the queue, then `restartPage`; `restartPage` also waits out any screen he is going through, `inFlowRef`).

## Batch: change a look's scheduled videos to another look - only those are made again
Only ./deploy.sh is needed; then close the Cutter and open it again.
**How to use it:** Batch tab, "How each hook is doing": each look has a line (Snapchat, Outline, White box, Claude +
X). Tap **Change to…** on the one that doesn't work, then the look you want - say Claude + X to Snapchat. Every
Claude + X video not out yet (scheduled in Postiz, waiting, or still to be made) comes out and is made again in
Snapchat, at its own day and time, with the same reaction and clips; one from Claude + X takes one of his
headlines. Claude + X stops being made and its share goes to Snapchat. Every other video stays exactly as it is.
**Which videos it can find:** a Claude + X video is told by its words, so all of them, old or new. A headline video
made before today doesn't record its look: when the batch has one headline look picked now, those count as that
look; with several, they show as "made before looks were counted" and can't be picked by look. From now on every
batch video records its look, one look or several, so any look can be changed later.
**How:** `batchRun.changeLook` (takeOutHook, then `batch.recastPicks` remakes each at its slot - never a combination
already made, next headline or amount instead; a slot too soon, or a clip no longer in the bank, is left to the
top-up), `batchHooks.swapLook`/`lookChoices`/`assumedLook`, `batchRun.videoOf` (shared with `planVideos`; a one-look
batch's videos now carry that look), `CampaignApp.addBatch` (`batch.look` always), `BatchView` `runChangeLook` and
the look lines in `HookResults`. Tests in `batchRun.test.ts`, `batchHooks.test.ts`, `batchView.test.tsx`.

## Captions stay on the words: fixing them by hand no longer slides them early
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What was wrong:** the captions are fitted to the cut (`captionWords`) every time they are shown - opening Captions,
every keystroke while fixing a word, the edit screen, and again when the video is made. Each pass started from the
times the last pass had fitted, and moved the last words before each cut up to 0.1 s earlier again. A video
checked quickly was fine; one where he typed fixes came out with words before each cut running well ahead of his
voice - "sometimes out of sync".
**Now:** each caption keeps when it was heard (`CaptionWord.heard`) and every pass starts from that, so going
through again changes nothing. A phrase retyped with more or fewer words is shared out over when it was heard.
Videos whose captions were already checked before this update keep the times they had.
**How:** `captions.ts` (`heard`, `heardTime`; `captionWords`, `retimePhrase`, `withRestored` use it);
test `captionSync.test.ts` (10 passes and a word typed a letter at a time land where one pass did).

## Batch: see how each hook does, stop one or change its words, and the batch remakes those videos
Needs deploying: run ./deploy-server.sh, then ./deploy.sh; then close the Cutter and open it again. No database change.
**Now, in the Batch tab, under Headlines - "How each hook is doing":**
- One line per hook: each headline (its words) and Claude + X, with how many went out, their views a video (read a
  day, three days and a week after posting; "views not read yet" until then) and how many are still to go. When the
  batch mixes looks, a line per look too (White box / Outline / Snapchat / Claude + X).
- **Stop using it** on any line: the videos with that hook not out yet come out (scheduled ones taken out of Postiz,
  queued ones dropped), their mixes are free again, and a running batch makes others in their place at once. Posted
  videos and one being made stay.
- **Change words** on a headline: type the new words; the videos with the old words not out yet come out and are
  made again with the new ones. The old words leave the list, the new ones start fresh.
- **Drop a hook that does badly by itself** (a switch, off until you turn it on): once 5 of a hook's videos have their
  views read, one averaging under half of what the other hooks get (over 5 of theirs) is stopped the same way, and
  the card says what was dropped and the numbers. Nothing to type.
- Videos made from now on carry their look, so the per-look lines count them; videos from before count by their
  words only. On a batch handed to the server, the lines show but the actions wait until the batch is back on the
  phone.
**How:** `batchHooks.ts` (`hookOfPost/Job`, `hookStats`, `groupHooks`, `weakHooks` with `WEAK_AFTER`/`WEAK_SHARE`,
`dropHook`, `dropLook`, `changeHeadline`), `batchRun.takeOutHook` (next to `startOver`: stops and unmakes only the
matching videos, recounts the days, keeps running), `BatchView` `HookResults` + `runTakeOut` + the automatic effect;
`JobBatch.look` set in `CampaignApp.addBatch`, server `batchInfo` keeps `look`, `postView` sends `batch.look` and the
post's `views`; `BatchBank.dropWeakHooks`, `droppedHooks`. Tests: `batchHooks.test.ts`, `batchRun.test.ts`.

## A video you add is listened to next, not after the whole batch
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What was wrong:** the queue made "videos for a chosen angle" before "the day's videos to listen to" - and the
batch's own videos count as the former. With a batch topping itself up (25 a day, a few minutes each), a video you
had just added sat at "Waiting to be listened to" until every batch video ahead of it was made, with nothing on the
Videos screen to say why (batch videos live on the Batch tab).
**Now:** approved videos first (as before), then the videos you added, to be listened to, then anything else you
added by hand (a reaction, clips and music), and the batch and format videos last - they make themselves whenever
the app is open anyway. The batch video already being made finishes first (one at a time); the row says so:
"Waiting to be listened to · after the batch video being made".
**How:** `CampaignApp` queue order (`approved` -> `queued && day` -> `queued && !day && !batch && !forFormat` ->
the rest), `behindLine` -> `JobRow` `behind`.

## A plan for the whole line and for students, written down (nothing built)
No deploy. `docs/PLAN_AUTOMATION_AND_STUDENTS.md`: how a campaign could go from the Reddit bot to the planner to the
Cutter to posted with as little of him as possible (A1-A7, in the order worth building), and how a few students
could get the tools privately - invite only, locked to their phones, paused or removed by him, their data and keys
apart, a first-run that walks them through, and what each would cost (B1-B8). Logins stay uncreatable until he OKs
part B.

## Captions on the word, phrases that stay up, and three taps gone from every video
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Changed for you (say if you want any of it back):**
- Captions screen: "Captions on the hook?" is no longer two buttons to choose between on every video. It is a switch,
  set the way you set it last, under the video's questions; Next keeps it. One tap instead of two, 25 times a day.
- Edit screen: the caption size and position you pick are remembered for the next videos, like the style already
  was. The same two picks in Settings are gone - they were the second place for one thing.
- Videos: an approved video waiting its turn can be opened and removed from the list (it could not be touched until
  it was made).
**Captions:**
- A word timed by the letter model stays on its word: the pass that gave a sentence's last words a quarter of a
  second to read used to move every word near a cut earlier - up to 0.9 s ahead of its sound on a fast ending. Now
  only words heard late (whose time was never known) are moved freely; a word timed exactly moves at most a tenth
  of a second.
- Highlight and Phrase styles: a breath inside a phrase no longer blanks it - the phrase stays up to the pause that
  starts the next one (half a second), as the style's own description said.
**Also:**
- A video is given three minutes, not 90 seconds, while the speech or letter model loads: a slow load on a phone
  that had just run the other model counted as the phone stuck, and restarted the page for nothing.
- The page never restarts itself over an open edit screen or editor (what you did there is written when you
  finish, and a restart would have lost it); it waits until you leave.
- A video whose "copy to send" could not be kept is said on screen; the edit screen repaints only when something
  changed; the three phone checks run together (the "restart the iPhone" advice came after up to 18 s); a request cut
  off by the page going away is no longer counted as a crash in the reports.
**How:** `CheckQuestions` (`hookOn` switch, `lastHookChoice`), `CampaignApp.setCaptionSize/Position` call the
default setters, `SettingsView` `CaptionPlace` gone; `captions.captionWords` (`pulledBack`, `MAX_EARLY_SEC`, in-order
pass), `captionAt(..., hold)` + `PHRASE_HOLD_SEC` (render, reactionRender, CaptionReview, EditScreen); `JobRow`
`expandable`; `CampaignApp` `stallLimit`, `inEditor`; `mediaProbe.mediaHealth`; `report.ts` AbortError;
`manualPictures` dead exports gone.

## Screens cleaned up at phone size: nothing runs off the edge, nothing cut short
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Now** (checked on screenshots at 440x956 and 402x874, dark and light):
- Formats: a format's page no longer scrolls sideways - each line's "2 takes · 1 made" and its + Takes ↑ ✕ buttons
  stay on the card. The tab says "No format yet" and what one is, instead of only a button.
- Posting (a campaign's times): "Between 11:00 AM and 6:00 PM" keeps both time boxes on screen; "3 a day" is a
  proper select; the Instagram place and Buffer key boxes are boxes again (they had the card's own colour, so only
  the words floated); long placeholders shortened so they aren't cut mid-word.
- Videos: the status line under a video shows up to two lines, so the reason it needs you and the headline are
  read whole; "Made, not sent" keeps its Remove on the card. Campaigns and Settings lines the same.
- Captions screen, Batch edit, a row's details: the music ▶ sits beside the pick instead of under it.
- Edit screen: "Video in the middle" on one line; the Claude re-check button keeps its cost on one line.
- Two-word choices ("Brand approves", "Straight away", "On the engine", "Reaction, then video") take two lines
  instead of being cut.
- Batch: Stop and Start over are buttons under the sentence, not links inside it; a format is no longer offered as a
  batch look.
- Posts: a failed post says "Not posted" instead of "As soon as it goes"; Watch says so when there is no copy to
  watch; the Select (stop) list has a line between posts. Edit again on a batch video: no tab bar or Cut only /
  Campaign videos switch over the editor, and Back goes to Posts.
- Bank: songs have Remove like pictures and videos; Analytics' number box looks like every other.
- Angle editor: the preview stays on every part, so the Look / Pictures / Sound / Effects / Clips tabs don't jump.
**How:** `campaign.css` (`.vrow-line`/`.row-line` two-line clamp, `.time-add`, `.bank-item .hint`, `input.find`,
`.music-pick`, `.format-takes`, `.clip-label`, `.analytics-target-row`, `.stop-picker .post`), `index.css` (`.seg button`
on phones), `BatchView` (`batchAngles`, actions row), `Editors` (preview on every part), `CampaignApp` (`inFlow`,
batch edit Back), `PostsView` (failed label, `Watch`), `FormatsView`, `MusicBankView`, `InstagramPlace`, `SettingsView`,
`CaptionReview`.

## Batch: a typed "Videos a day" applies when you leave the box; posting through midnight takes its times
Needs deploying: run ./deploy-server.sh, then ./deploy.sh; then close the Cutter and open it again. No database change.
**Now:**
- Batch: the "Videos a day" number applies when you leave the box (or press Enter), not on every keystroke. Typing
  "30" used to apply "3" first: a pause of a second over it stopped the week's posts in Postiz and made them all again.
  − and + still act at once.
- Batch: the tab's list of posts is kept fresh (every minute, and when you come back to it), so "Next 7 days: X of Y"
  and the Start over note no longer read a list from when the tab was opened.
- Posting: a campaign whose random times run past midnight (say 10 PM to 2 AM) now takes its own times for a video
  made today. Judged by the date alone, this morning's early times (last night's) always looked missed, so every such
  video was spread "late" until midnight instead; and late in the evening, with tonight's times gone, the next is
  tomorrow's early one, not a day later.
- Bank: taking a picture out asks first, like videos and songs do.
- Formats: a format's page no longer re-plans the month's schedule on every tap.
- Unused styles taken out.
**How:** `BatchView` number box (`perDayDraft` applied on blur/Enter), posts read on a timer; `slots.sessionOf` +
`pickTime({ session })` (`takeSlot` passes it), tests in `slots.test.ts`; `BankView` confirm; `FormatsView` `placeKey`;
`campaign.css` (`.sound-grid`, `.sync-row`, `.mode-row`, `.pic-list`, `.pic-row-main`, `.pic-row-controls` gone).

## Two crashes fixed, every post shown, nothing goes out after a Stop, and posts stop coming back to approve
Needs deploying: run ./deploy-server.sh, then ./deploy.sh; then close the Cutter and open it again. No database change.
**What the reports showed:**
- The two crashes of 2026-10-22 19:22 ("undefined is not an object (evaluating 'o.filter')" and "'e.map'") were one
  answer from the server cut off mid-way: the phone took an unreadable answer for "no posts" and the Posts screen fell
  over on it. The crash "The object is in an invalid state" (five times across builds) was the angle preview drawing a
  logo picture it had just let go of, when the logo was switched off or changed.
- 15 scheduled and 3 waiting posts were missing from the friend's Posts screen: the server sends the newest 300 rows,
  and a Stop or a Start over (hundreds of rejected rows at once) pushed live posts off the end.
**Now:**
- Posts: an answer cut off is tried again by itself, never shown as an empty list. The angle preview never draws a
  picture it has let go of.
- Posts: every post still to go is always in the list, whatever happened lately; the finished ones of the last three
  days after them.
- Posts: a post stopped, taken back or replaced (Add music) in the very moment the server was putting it into Postiz
  stays stopped - the server takes what it just created out of Postiz again. Before, it went out anyway, and with Add
  music both versions did.
- Posts: during a Postiz outage an approved post stays approved and is tried every half hour for a day, instead of
  coming back to To approve after an hour (25 to approve again, every hour). Take back works on it all the while.
- Posts: a post Postiz publishes late is still seen as posted - the server keeps asking (every 8 minutes, then hourly)
  for three days, and only then says "Postiz never said whether it went out", with Post again. One from 2026-10-16
  had sat in Scheduled for a week.
- Posts: a caption the server rewrites or re-tags while the screen is open shows up in the box, instead of the old
  words going back on the next tap. Take back is there on every approved post (one with no time yet had no way back).
  Approve all approves three at a time instead of one after another.
- Videos: a made video whose copy to send couldn't be kept says so on screen (it used to look sent). "Send to Postiz"
  no longer shows on a remade video already in line.
- A video that can't be sent until you act (its copy gone) is no longer retried every five minutes; Try again puts it
  back in line. The same report within ten minutes is sent once (one missing bank file sent 200 reports in 7 s).
**How:** `posting.call` (unreadable body -> retry), `askPosts` (`posts ?? throw`); `Preview.tsx` (`logoRef`, closed
bitmaps never drawn); server `listPosts` (live + recent, two reads), `updateIf` + `scheduled()` guarded on
`approved` (and `deleteScheduled` when not), `failed()` `LATER_GIVE_UP`, `creating_at: null` on every retry,
`checkPosted` (`UNCONFIRMED_MS`, hourly after six looks) + `giveUpUnconfirmed` in the tick, `unschedule` past check
only when scheduled; `PostsView` `typed` caption state, Take back, `approveAll` three workers; `CampaignApp.sendToPostiz`
notice, `postByHand` via `jobOfPostKey`; `outbox.pump` skips `stuck`, `retryStuck`; `report.ts` `SAME_REPORT_MS`.

## "Cut "um"s and stumbles" works: the model is told to write them down, and each is cut between its neighbours
Only ./deploy.sh is needed; then close the Cutter and open it again. Settings, Speech, "Also cut "um"s and stumbles"
is the same switch as before (off unless you turned it on).
**Why it never worked, with the proof:**
- The speech model never wrote the "um"s down. Whisper was trained on transcripts with them taken out, so left to
  itself it leaves them out: across the 219 videos posted from the Cutter (29,650 words) its transcript has "um"
  once. Run here with the phone's own model (whisper-tiny.en, the OpenAI weights) on 89 s of radio talk, it wrote 0
  "uh"s; a model trained on word-for-word transcripts (NeMo conformer) heard 14 in the same clip. A cut can only
  remove a word that was heard, so nothing was ever cut.
- Even when one was heard, the cut asked for a true pause on both sides of it, and an "um" is said straight on
  from the word before ("at least, um, you know"): on the recordings here not one heard "uh" passed that check.
**Now:**
- When the switch is on, the model is told "So, um, I think, uh, yeah." after the brand names before it listens,
  and writes down the fillers it hears. Measured here: 7 of the 14 "uh"s in the radio clip, the "um" in a phone
  call; none invented on read speech, laughter or French. A longer prompt got the model stuck repeating itself, so
  the prompt is short - and any stretch the model does get stuck on ("okay, okay, okay..." - it happens with the
  names alone too) is heard again with the names only, and failing that the loop is folded to two.
- The letter model that times the captions now also listens between the words it placed: a stretch that spells
  "um", "uh", "hm" and nothing else, for long enough, is an "um" the speech model left out. And an "um" the speech
  model wrote where the letters say a real word ("THE") is kept as the word it was.
- Each "um" and stumble is cut between the word before and the word after it, at the quietest moment near each,
  no pause needed - with the words timed exactly by the letter model. The sound still has the last word: a cut
  holding a second separate sound, or more sound than an "um" makes, stays in. With rough times only (the letter
  model could not run) the old careful rule stays, so a rough corridor never reaches into a word.
- Checked here on two real recordings run through the app's own cut (`umsFixture.test.ts`, fixtures in
  `fixtures/ums-*.json`): every "uh" the model heard is cut, each between its neighbours, no real word touched.
  Not checked on an iPhone: the word-level times the phone's model gives with the longer prompt, and what the
  letter model hears over an "um" there - each video with the switch on now sends a `check`/`ums` report ("4 "um"
  heard (3 by the speech model, 1 by the letters), 3 cut, 1 left in; 0 stumble cut; exact times") to see.
- Captions never show an "um" or an "uh" - cut or not - as TikTok's don't; the model's notes for sounds that aren't
  words ("[Music]", "(laughs)", "♪") are no longer words either. The caption written for the post leaves them out
  too. The edit screen shows every cut as before, so an "um" cut wrongly can be put back.
**How:** `keywords.FILLER_PROMPT` + `listeningPrompt(names, { fillers })`, `pipeline.listen` (`fallbackPrompt`),
`transcribe.worker` (second listen, `timedWords.stuckOn/unstuck`, `isNonSpeech`), `align.lettersBetween/fillersBetween`
+ `TimedWord.letters` (align.worker), `plan.speechCuts(..., exact)` after alignment, `soundsLikeFiller`,
`plan.fillersHeard` + `fillersLine` report, `fillerWords.isFillerWord`, `CutOptions.exact` (`edgeNear`),
`WordChunk.keep`; `captions.captionWords/withRestored` skip fillers (`CUT_ON_PURPOSE` gone); `sort.firstLineHeadline`
uses the shared check. The plain cutter's path is untouched (no prompt, no `exact`).

## Captions also shows the pictures that come up in the video
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Now:** the screen Captions opens lists "Pictures in this video" under each video's headline and music - every
picture that comes up when its words are said, each with a tick to keep it or leave it out of that video. A video
with none says "No pictures come up in this video." They left the row in the list like the other questions (a
video with no Captions screen still has them in its row).
**How:** `JobRow.PictureToggles`, shown by `CheckQuestions` (`pictures`, `onSkipPicture` = `CampaignApp.picturesFor`,
`setSkipPicture`) and by `SortedDetails` only without Captions.

## The edit screen works like TikTok's editor: move the headline, add text, put a picture or video over you
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Now, on the edit screen (Captions):**
- The headline is on the video where it will be. Drag it anywhere, pinch it (or its Size slider) bigger or
  smaller. Tap the Headline chip under the timeline to find it again; Put back returns it to the angle's spot.
  The next videos of the same angle start with it where you last put it (on this phone), until you move or put
  it back. A video keeps the spot it was approved with.
- **+ Text** puts your own words on at the playhead, in the middle, in the headline's look (White box /
  Outline / Snapchat to change). Type, drag, pinch, set how long it stays up, Start it here, Delete words.
  Words left empty go away by themselves.
- **+ Overlay** (was + Picture): a photo or video from your phone, a picture from the picture bank, or a video
  from the video bank. A video plays over you, muted, in its own box, for its own length (up to a minute);
  drag and pinch it like a picture. Pictures and videos are now dragged straight away, no first tap needed.
- Things that are up at the same time get their own row on the timeline, so they no longer cover each other.
- All of it is in the made video exactly as on the screen: same layout code for the preview and the render.
**Checked here:** a real render in Chrome (H.264) with a moved, enlarged headline, words from 1-3 s and a video
overlay from 2-4 s - each where it was put, gone after; the editor at 440x956 with a finger drag of the
headline. Not checked on an iPhone: Safari playing a second video in the editor, and the render on the phone.
**How:** `manualPictures.ts` (`source.kind` `text` / `video`, `isText`/`isVideo`, `textHeadline`, `longestFor`),
`render.ts` (`texts`, `overlays`, `overlaysLeftOut`), `pipeline.make` (`byHand`), `overlay.layoutHeadline`
(`place`), `look.withHeadlinePlace`, `headlinePlace.ts`, `CutsEditor.tsx` (`headline`, `videoBank`,
`loadVideo`, `overlayRows`, `.cuts-text-hold`), `CampaignApp.headlineEditFor/setHeadlinePlace/byHandFor`.

## Videos screen: one Captions button asks everything, the row is clean
Only ./deploy.sh is needed; then close the Cutter and open it again.
**Now:**
- Tapping Captions on a video (or Check N for several) opens one screen with everything about it: where it goes,
  the headline and its look (White box / Outline / Snapchat), the music, and - when it has a headline - captions
  on the hook. All start as they would be made, so with nothing to change it is one tap on to the edit screen.
  Several videos: each one's settings on the same screen, the hook asked once.
- The row in the list no longer has Goes to, Headline, its look, Music, Effects or Edit cuts: the Captions screen
  has the first four, and the edit screen has the cuts. Effects is gone for good - every video gets the default
  effects, as it always did. A video with no Captions screen (a reaction he doesn't talk in, or captions turned
  off) still has them in its row, without Effects.
**How:** `CheckQuestions.tsx` (was `HookQuestion.tsx`; `lastHookChoice` kept) is shown for `CampaignApp.asking`;
`startCheck` always asks, `answerQuestions` keeps the hook answer when it was asked. The four fields are
`JobRow.VideoFields`, shared by the questions screen and a row without Captions (`SortedDetails` `asked`).

## "Making it 0%": the Cutter checks whether it is the iPhone, and says so
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What the reports showed:** since 18:00 on 2026-10-22 every talking video on his phone stopped at "Making it 0%" -
a 191 MB one, a 673 MB one, then a 19 MB one - after closing and opening the Cutter too, and the plain cut as well,
while two videos made just before had gone through. Not the size, not the video, not his friend's batch (that is made
on the friend's phone; each phone makes its own videos). Something under the Cutter stopped answering: WebKit's
private storage (every video opens a file there before its first frame) or the iPhone's video hardware.
**Now:**
- When a video stops at 0%, the Cutter checks the three things every video needs - storage, the video encoder, the
  decoder - a few seconds each. If one isn't answering it says so ("restart the iPhone") instead of failing video
  after video, holds the videos (nothing is lost or marked failed), checks again every minute and carries on by
  itself once they answer.
- Storage that doesn't answer within 10 s no longer stops a video: it is made in memory instead, and the copy kept
  for sending falls back to the database after a minute.
- The report says where the video stopped (now including "opening where the video is written" and "the headline
  font") and the result of the three checks.
**How:** `mediaProbe.ts` (`mediaHealth`, `healthAdvice`; checked in Chrome for Testing: all "ok" there, and the
encoder's failure caught in a browser without H.264); `CampaignApp` StallError path; `media/outputSink.ts`
`createOutputSink` waits at most 10 s for storage (`openOnDisk`, else Blob pieces); `outbox.keepCopy` at most 60 s.

## A video that stays stuck at 0% is let go, and says where it stopped
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What the reports showed:** the phone was still on the build from 18:04, before the restart fix - and in that fresh
page the same 191 MB video stopped at 0% again on its first try. So a fresh start doesn't free that one video: it is
the video. Each stuck try cost 90 s, then another go and the plain cut (made the same way) waited 90 s each too, and
the approved video behind it ("Approved") waited its turn the whole time.
**Now:** a video stuck at 0% gets one fresh start of the Cutter; stuck again, it is marked failed straight away with
what the video is (its format, size, length) and the videos behind it are made. The report says exactly where it
stopped ("at 'making the frames' for 90 s, 0 frames read") and what the file is, so the next one can be fixed at the
cause. In the Videos list, an approved video now says "Approved · waiting its turn to be made".
**How:** `renderTrace.ts` (`traceStep`/`traceRead`/`traceWritten` from `render.ts`, `traceLine`, `describeVideo`);
`CampaignApp` StallError: restart once (`firstRestartFor`), then failed at once - no in-page retry or plain cut.
`JobRow` approved line. Test `renderTrace.test.ts`.

## A video stuck at 0% starts the Cutter again by itself
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What was wrong:** "it's just at making it 0%". On 2026-10-22 two videos were made, then a 191 MB one stopped
moving: tried again three times (each 90 s at 0%), then marked failed - and the next one (673 MB) sat at 0% too. Once
the phone's video maker goes quiet in a page (often after the Cutter was left for another app), it stays quiet until
the Cutter is closed and opened again; trying again in the same page only waits.
**Now:** the first time a video stops moving, the Cutter says so and starts again by itself - not while you type or
pick videos, and only once a video being kept is safe - and every unfinished video carries on where it was. Once
per video: if the same one gets stuck again after the fresh start, it is that video's problem and goes the usual
way (another go, the plain cut, Try again).
**How:** `stallRestart.ts` (`StallError`, `firstRestartFor`, remembered 6 h per video in localStorage);
`CampaignApp` `watched` throws `StallError`, the catch path resets the video's attempts and calls `restartPage`
(waits for `pickQuiet`, saves and outbox copies; nothing new starts meanwhile). Test `stallRestart.test.ts`.

## Instagram location on every Instagram post (waiting on Postiz)
Needs deploying: run ./deploy-server.sh, then ./deploy.sh. No database change.
**What it is:** Settings, Posting has **Instagram location**: paste a place's Facebook page link (or its Instagram
location page, or its ID) once, and every Instagram post the Cutter schedules is tagged with it. A campaign can have
its own, in its Posting (shown only for a campaign posting to Instagram).
**What's not there yet:** Postiz keeps the place with each post but doesn't pass it on to Instagram - its Instagram
settings have no location. The request and the change for them (about 30 lines) are in `docs/postiz-location`; the
day they add it, every post already scheduled shows the place, nothing to do here. Postiz accepts the extra setting
today without refusing the post (checked in their code).
**How:** `postiz/place.ts` (`parsePlace`, `cleanPlace`, `instagramPlace`), `settingsFor(..., place)` adds
`location_id` for Instagram, action `save-place`, `saveCampaign` keeps a campaign's `instagramPlace`;
`InstagramPlace.tsx` `PlaceField` in Settings and `PostingEditor`. Tests: `place.test.ts`, `postingEditor.test.tsx`.

## The music bank is shared by everyone who uses the Cutter; Analytics shows views again
Needs deploying: run ./deploy-server.sh (both functions), then ./deploy.sh; then close the Cutter and open it again
on each phone. No database change.
**Shared music bank.** A song added on any phone now shows on every phone that uses the Cutter - yours and your
friend's. Each phone's songs go up the first time it opens after the update (only the sound: a song taken from a
video is its sound alone). The others' songs show in the list at once; a song's file comes down the first time it
is played or used, so nothing fills the phone. Renaming or taking a song out does it on every phone. The same song
added on two phones is kept once. Videos already made keep their music.
**Analytics was empty** because the server's count of "videos posted to this account this week" always came back 0
(its query was written wrong), so no Instagram account ever got a "views a video" number and the tab stayed on
"Reading your views from Postiz". The count is fixed, and accounts already read get their number the first time
Analytics opens - Michaelangelo (@traderzi2), for one, is about 740 views a video this week. The week-on-week trend
fills in over the next days.
**How:** server `cutter/songs.ts` + actions `songs`, `song-upload`, `add-song`, `rename-song`, `remove-song`,
`song-urls` (behind the login); phone `musicBank.ts` `syncSongs`, `mergeSongs`, `ensureSong`, `findSong`;
`cloud.askShared`. Analytics: `postiz/index.ts` `postedThere` (jsonb `contains` as JSON text), `views` fills
`views.fillPerVideo`. Tests: `cutter/songs.test.ts`, `sharedMusic.test.ts`, `views.test.ts`.

## Posts screen: approved posts with Scheduled, one line for everything going up, no false "No connection"
Needs deploying: run ./deploy-server.sh, then ./deploy.sh; then close the Cutter and open it again.
**What was wrong:**
- About 17 Loveable zi posts for Wednesday sat in "On the way" saying "Going to Postiz…" since yesterday. They were
  approved during the Postiz outage; a post days ahead then waited until 6 hours before its time to ask Postiz again
  (the Buffer backup rule), so they looked stuck and weren't in Postiz. They were put back in line by hand
  (2026-10-22 17:30 UTC) and are all scheduled in Postiz now.
- Videos going up showed "No connection" at 0% for an hour while the phone had signal. The phone sends one video at a
  time; the others were only waiting their turn but showed the error from an earlier try. That error came from
  Supabase turning away a burst of 18 questions in 3 seconds (the Posts screen, the Videos count and the Batch tab
  all asking for the posts as each video finished) - its "too many" answer can't be read by Safari, which calls it
  no connection.
**Now:**
- Approved posts are listed with Scheduled, with their time and Take back - approved is scheduled, to you.
- On the way is one line: "12 videos going up - Now IMG_1 45% - 11 waiting their turn - Claude is writing 2
  captions". Tap it to see each one. Only a video you have to act on (its copy gone from the phone) gets its own row,
  with Try again / Stop sending.
- The server asks Postiz again every half hour for posts it turned down, and when one gets in the rest follow at
  once - after an outage they go into Postiz within the hour, not hours before their time.
- The phone asks the server once for everyone asking at the same moment, and tries once more before saying there is
  no connection.
**How:** `postiz/index.ts` `POSTIZ_WAIT`, `probePostiz` (in the tick), `unschedule` takes back approved posts too.
`outbox.ts` `Sending.now`, `SendEntry.stuck`; `PostsView` `OnTheWay`, approved in Scheduled; `posting.ts`
`shared` (`listPosts(fresh)`, `listViews`, `refreshProfile`), `call` retry and 429. Tests: `postsFlow.test.tsx`,
`outbox.test.ts`, `posting.test.ts`.

## Reports: Safari's own "EmptyRanges" error no longer counted as a crash
Rides the next ./deploy.sh. 39 "crash" reports in ten days were Safari's own script ("Can't find variable:
EmptyRanges"), not the app's: Safari 26 names its file "undefined" instead of none, so the filter let them through.
**How:** `report.safarisOwn` treats the file "undefined" as no file. Test in `report.test.ts`.

## Posting times follow each campaign's own schedule; no 30-minute floor past 48 a day; Add anyway and Start anyway
Needs deploying: run ./deploy-server.sh, then ./deploy.sh; then close the Cutter and open it again. Nothing in the
database changes. Posts already scheduled keep their times - only new ones follow the new rules.
**Your schedule is yours.** Every post used to be squeezed into 11 AM - 6 PM whatever the campaign said: a window
of 1 AM - 11:59 PM (Lovable 16 has one) was cut back to 11-6, and his own times outside it (01:25, 08:00, 23:00...)
were skipped. Now a campaign posts at all of its own times, or anywhere in its window as he set it. A window that
ends at or before it starts runs past midnight: 10 PM - 2 AM, or 1 AM - 1 AM for the whole day. A campaign with
neither still posts at random 11 AM - 6 PM, 3 a day, as before. Late videos spread until the end of the campaign's
own window (never past midnight).
**No 30-minute floor when you want more.** Times stay 30 minutes apart while they fit (up to 48 in a whole day),
and close up evenly past that instead of stopping at 42: 125 a day on one account in a whole-day window is one every
11 minutes. The only limit is a minute apart. Note: Instagram itself takes 50-100 posts a day per account through
its API (Meta's own pages say both), so 125 a day on one Instagram account will hit Instagram's limit, not ours.
**Add anyway.** When something is turned down for being used before, a button now lets him use it again:
- New post: a video already sent for the campaign today - "Add it anyway - post again" posts it again as a new post
  (its own send key, so tapping Post twice still makes one).
- Batch tab: a reaction or clip already in videos made - "Add it anyway" takes it back in, as a clip of its own.
- Formats: an opening that already opened a video - "Add it anyway" takes it back in, for a new video.
**Start anyway (red, next to Start).** When some of a batch's mixes were already made, Start only makes the rest
(or none). The red button makes them all again for this batch - for redoing a batch that wasn't good. The check
that stops repeats stays on for every other Start.
**How:** `window.ts` `DAY`, `inDay` and `dayWindow` are gone; `lengthOf`/`pastMidnight` handle windows past
midnight; `gapFor` floors at `LEAST_GAP_MINUTES` (1) and `windowTimes` defaults to it. `slots.timesFor` keeps every
own time, `spreadUntil` gives `spreadEnd` the window's end, `dayTimeFor` is gone (a post moved by an account's daily
cap keeps its time of day), `batch.batchChoices` keeps a batch video's own time, and `schedule` no longer moves
night slots. Phone: `posting.ownDayTimes`/`windowOf`/`batchGap`/`stackTimesOn`, `PostingEditor` hints.
`BankFile.again` + `batch.usedKey` (Batch and Formats), `NewPost` `Picked.again`, `BatchBank.anyway` read by
`fromPhone` so the Cutter server forgets its `made` too. Tests: window, slots, batch, posting, postingEditor,
batchView, serverBank, formatsView, and a new newPost test.

## Batch: a step with one clip plays whole (no more videos cut at 11 s), and no most a day
Only ./deploy.sh is needed; then close the Cutter and open it again. Videos already made stay as they are - Start over
in the Batch tab makes the ones not out yet again.
**What was wrong:** "the videos always cut at 11 seconds, so I lose the last part of the product". In Lovable 16 his
steps are draw, photograph the drawing, then one whole 16-second video of the products - the same clip in every
video. Every step played only a "moment" of its clip (at most 5 s, or 2-3.5 s when the whole clip moves, as an
edited product video does), and all steps together at most 12 s: his videos came out 7-13 s, the products cut short.
Not the music: a song shorter than the video goes round, faded at the seam.
**Fix:** a step with a single clip is a fixed part of every video, so it plays whole and doesn't count toward the
12 s. Steps with several clips still play a moment of each (Loveable zi, 9 steps of 3+ clips, is unchanged). His
Lovable 16 videos now run about 22-24 s: reaction, steps 1-2, then all 16 s of the products.
**Also: no most a day.** Videos a day and More each day (+1, +2...) no longer stop at 25 - the + button, typing a
number, the growth and the Analytics suggestions all go past it. What still caps a day is the posting window
(11 AM - 6 PM, 10 minutes apart: about 40 a campaign), and the Batch tab says when a day no longer fits.
**How:** `stepPiece.playsWhole`; `CampaignApp` sets `windows` from the campaign's steps as they are now (one file:
false). `BATCH_MAX_PER_DAY` is gone: `batchRun.perDayOn`, `growthSummary`, `analytics.stepFrom`/`suggestRate`,
`BatchView`; `posting.batchTimesOn`/`stackTimesOn` draw at least twice as many candidates as wanted. Tests updated.

## Buffer backup: never more than 10 waiting per account, for accounts posting 25 a day
Needs deploying: run ./deploy-server.sh (server only - nothing changes on the phones).
**What was wrong:** his friend's @jakelikesai (Postiz "Jake") posts 25 a day, about one every 17 minutes from 11:00
to 18:00. Buffer's free plan holds only 10 scheduled posts per account, and the backup handed Buffer everything due
in the next 6 hours - about 20. Buffer would have turned half down, and those would have gone back to "waiting" for
him to approve again.
**Fix:** at most 10 wait in a Buffer account at once, the earliest first; each one Buffer posts makes room for the
next, on the following ticks. A post waiting for room stays approved (or held in Postiz) and goes in as soon as there
is room - never back to him. A post Buffer actually turns down is tried again every 10 minutes, and comes back to him
with Buffer's reason only after 6 tries. If Buffer says it's full before we count 10 (posts added in Buffer by hand),
that counts as full too, not as a failure.
**How:** `buffer.ts` `BUFFER_QUEUE` (10), `roomLeft` (from `cutter_posts.buffer_ids` not yet sent or failed),
`isFull`, `handOverPlan` earliest first; `index.ts` `bufferRoom`, `toBuffer(..., room)` (returns `full`), `schedule`
keeps a backed-up post approved with `retry_at` +10 min, `handOver` stops at a full channel. Tests in `buffer.test.ts`.

## Buffer as a backup for Postiz: same video, caption and time, same Instagram accounts
Needs deploying: run ./deploy-server.sh, then ./deploy.sh. The database change (Buffer keys, which posts went through
Buffer) is already applied - migration `20261022120000_cutter_buffer_backup.sql`, OK'd by the owner 2026-10-22.
**Why:** Postiz went down (2026-10-21 21:28 UTC: every new call "Application not found"), and MediaMaxing's
@traderzi2 can't miss a day. "If ever Postiz fails to post anything, then we have a good backup that can post for us."
**How to use it:** Settings, Posting, **Backup · Buffer**: paste the Buffer API key (in Buffer: Settings, API,
Personal Access - pick 1 year), **Add**. It finds the accounts it backs up by itself - the same Instagram username in
Buffer and Postiz - and says "Backs up @traderzi2 on Instagram". Up to 5 keys (one per Buffer account).
- **By itself:** a video Postiz can't take (down, refusing) goes through Buffer for the backed-up accounts, at the
  same time with the same caption. One not due for over 6 hours stays with Postiz and is tried again nearer its time
  (Buffer's free plan holds only 10 posts a channel).
- **"Postiz is down: post through Buffer"** (the switch under it): the posts Postiz *already holds* for those
  accounts go through Buffer instead, a few hours before their time - and ones missed in the last 2 hours from now on,
  30 minutes apart - and are taken out of Postiz as soon as it answers, so none goes twice. Turn it off when Postiz is
  back. It's a switch, not automatic, because Postiz's own scheduler can keep posting while its API is down (it did on
  2026-10-21) - handing those over by itself could post a video twice.
- Posts show "via Buffer" in Posts; once Buffer has sent them they turn Posted, with the link. Rejecting or stopping
  one takes it out of Buffer too.
**How:** `postiz/buffer.ts` - Buffer's GraphQL API (api.buffer.com, the key as Bearer): `listChannels`,
`matchChannels` (by username), `createPost` (`customScheduled` + `dueAt`, the video as a public link, Instagram as a
Reel shown on the feed - as a post if Buffer turns that down), `readPost`, `deletePost`, `handOverPlan`. In
`index.ts`: keys sealed like the Postiz key (`cutter_profile_secrets.buffer_keys`), channels in
`settings.backup`; `PostizProblem` marks Postiz's own failures; `prepare` goes on without Postiz's copy for a
backed-up post, `schedule` hands the backed-up accounts to Buffer (`toBuffer`, saved per account in
`cutter_posts.buffer_ids` so none goes twice); tick: `handOver` (the switch), `checkBuffer` (posted/error, links),
`unpostHanded`. Buffer fetches the video from the server's signed link - a backed-up account now keeps the server's
copy until its post is out (it used to go once Postiz had it) - or else Postiz's copy. Phone: `BufferBackup.tsx`,
`posting.saveBackup`. Tests: `buffer.test.ts`, `bufferBackup.test.tsx`.
**Not checked here:** Buffer itself - this computer can't reach api.buffer.com. Built from Buffer's API docs and two
open-source clients that use it; the first real call is his key. The 85 @traderzi2 posts Postiz already holds have
no copy on our server (it went once Postiz took them): Buffer fetches them from uploads.postiz.com, which works only
if Postiz's file storage is up.

## Formats: a script you film again and again, mixed into a month of videos
Only ./deploy.sh is needed; then close the Cutter and open it again.
**What changed:** a format was one take = one video. He meant a script: "ELON MUST BE STOPPED", "NO WAY HE DID THIS",
"Oh and by the way vertus", "Link in bio" - each line said 30 different ways, and the app mixes them into 30 videos,
"so half of my work is automated for the month".
**How to use it:** Formats, open a format (or + New format). Under **Script**, type each line and **+ Add line**, in
order. Each line has **+ Takes**: pick all your takes of that line. When every line has takes, **Make 30 videos**
(the number is how many takes line 1 has). Each video opens with a different take of line 1 - never the same opening
twice - then takes one of every other line: the one in the fewest videos so far, and of those the one filmed closest
to that opening, so takes filmed together stay together. 30 takes of every line make 30 videos with every take once;
3 takes of "Link in bio" go round evenly. The takes of each video are joined, then cut, captioned and made with the
format's look and clips, and wait under Ready as before: Watch, Save for the brand, then **Over the month** (new),
the week or the next 5 days. Next month: add new takes of line 1 (and of any other line - new ones go first) and
Make again. A take you add twice is skipped and named; an opening already made can't be added again. Tap "30 takes"
to see a line's takes: watch one, or ✕ it. ↑ moves a line up, ✕ takes it out. A one-line format still makes one
video per take.
**How:** `formats.ts` `FormatScript` (lines, takes, `uses`, `opened`), `mixesOf`, `afterMixing`; the script in
meta `format:<angleId>` (`store.loadFormatScript/saveFormatScript/deleteFormatScript`), takes kept once like the
Batch tab's clips (`saveBankFile`). `CampaignApp.makeFormat` queues a job per video with `formatMix` (its takes, read
from the bank, no copies) and `prejoin`, id `format-<angle>-<opening fingerprint>` (Make twice can't make one twice);
`joinFirst` reads them from the bank. Used openings and taken-out takes go from the phone once no video still to be
made needs them (`retireBankFiles`, the sweep now also keeps `formatMix` takes); a deleted format or campaign lets
its takes go (`forgetFormats`). `daysLine` says "Thu 22 Oct to Fri 20 Nov" past a week. The old "+ Add takes" (each
take its own video) is gone - a one-line script does the same. Tests in `formats.test.ts`, `formatsView.test.tsx`.
**Checked here** in Chrome for Testing on the real app: lines, takes (kept, duplicate skipped), Make 2 videos from
3 lines x 2 takes added out of order - paired by filming time - the takes joined into one H.264 + AAC file from the
format's keeping, and the script and videos still there after a reload. **Not checked here:** the rest of making
(listening needs the speech model, which this computer can't download) - that part is the same road "Join first"
and format takes already took - and the iPhone.

## A hook that lags at the start now says so too (not only one that freezes)
Only ./deploy.sh is needed; then close the Cutter and open it again. Nothing changes in the videos themselves.
**What was wrong:** the report that a batch video's start held or skipped frames (`cutter_errors`, phase "start") only
spoke up for a first picture held 70 ms or a gap of 3 frames or more. The laggy hooks were frames coming every other
one, each shown twice - gaps of 2 frames - so a lagging start passed as fine. And the green screen layout had no
check at all. On build 22:20 the phone made 21 batch videos (from the reactions that lagged worst before), none
reported, so none froze - but whether any lagged, that report couldn't tell.
**Fix:** the start is now counted as it is watched: of the video's first 45 frames, how many show the same picture as
the one before, beyond what the clip's own rate explains (a 24 a second clip repeats one in five; a 30 one none).
Two or more extra and it reports, with the clip's own frame times. Green screen videos report the same about his
cut-out ("IMG_0021.mov (green screen): ..."). Checked on files made with ffmpeg: quiet for ordinary 30, 29.97, 24 and
60 a second clips, a trimmed clip and a clip cut between key frames; it speaks up for a clip whose every-other start
lasts past the second the Cutter skips (18 of 45 frames repeated), which the old check passed.
**How:** `montageRender.openingProblem(opening, frame)` (repeats on the steady frames, `OPENING`), the clip's own frame
length from its packets (`clipParts.usualFrame`, hidden lead-in frames not counted); `greenScreenRender` notes when
each cut-out frame first comes on screen; `makeGreenScreen` passes the reaction's name. Tests in `firstShown.test.ts`.

## Batch: more videos each day ("start with 4 and add +1 per day")
Only ./deploy.sh is needed.
**How to use it:** Batch tab, Posting: **Videos a day** is today's number; **More each day** (0 to +5) adds that
many each day after - 4 today, 5 tomorrow, 11 in a week - up to 25 a day, the most a batch makes. It says where it
goes, and from which day the posting window is too small for it. Change either any time: it carries on from today.
0 is the same number every day, as before.
**How:** `BatchBank.growth` and `growthFrom` (his number is `perDay` on that day); `batchRun.perDayOn` gives each
day's number, used by the top-ups (`runSlots`), trimming (`overfull`, `trimPlan`), the week's count and the days
left (`daysToMake`); `withPerDay`/`withGrowth` change them from today; `growthSummary` is the line under it.
Analytics shows today's number and suggests nothing for a growing batch. Same on the Cutter server (both are his
settings, sent with the bank).

## Fix: a reaction that froze at the start now just plays
Only ./deploy.sh is needed; then close the Cutter and open it again. Videos already made stay as they are - Start over
in the Batch tab makes the ones not out yet again.
**What was wrong:** some batch videos froze on the reaction's first picture for up to a second, then played; others
showed the first frames twice each (laggy). Both come from how a clip's first frames are stored: a clip cut where
there is no key frame can't show anything until the next one, and the video held its first picture until then; a
clip whose first frames come every other one played them at half speed. Reproduced here with files built both ways,
on the code that was live: 16 frames frozen, and 10 frames doubled.
**Fix:** every clip starts where its frames are steady (`clipParts.steadyFrom`/`steadyStart`, from the packets alone,
never more than a second skipped), and a batch clip whose first frame only comes later starts on that frame instead
of freezing on it (`writeWhole`). Both test files now play every frame from the first one. A video whose start still
holds or skips frames reports it (`cutter_errors`, phase "start", `montageRender.openingProblem`), and each reaction
is reported once more with where a video starts it.

## The Cutter server: every batch made on Railway, day and night, with the phone closed
./deploy.sh for the phone, then the Railway steps in `server/README.md` once (no ./deploy-server.sh: the login
function already has `whoami`). New dependency, OK'd with the server: `@mediabunny/aac-encoder` 1.58.0 (only the
server loads it - phones never download it).
**What it is:** the Cutter itself, running in Chrome on a server. Same mixing, same rendering, same sending, so the
same videos - only the phone is left out. He asked for "a one-to-one replica ... the only difference I want is for
it to be outside of my phone": the phone overheated making them, and only made them while it was open (10 a day
asked, 20 in Posts).
**How to use it:** Settings, **Server**, paste the Railway address, **Connect**. Then nothing: every batch moves
there by itself - the clips go up once while the app is open, then every change made in the Batch tab follows. The
Batch tab says "Running on the server", what it is making now and how many more, and "Next 7 days: X of Y made".
Start, Stop, the number a day, Start over and the clips all work as before. Settings, **Make batches on this phone
again** brings them back. The old **Engine** box only shows on a phone that already uses it.
**How:** `server/main.mjs` (Node, no packages) runs Chrome for Testing headless on `campaign.html?server=1`, checks
the phone's login with `whoami`, takes clips in 8 MB pieces (HEVC/HDR made H.264 by ffmpeg once), and passes the
banks to the page through an inbox. The page (`serverMode.ts`) signs in as the phone, in his time zone, writes AAC
with mediabunny's own encoder (Chrome on Linux has none), and reports what it made. The phone (`serverLink.ts`)
hands each batch over (`batchRun.handOver`: its queued videos left to the server, the days counted again) and reads
the server's progress back; `batch.fromPhone` keeps his settings the phone's and what was made the server's, so no
video is made twice. The server keeps no copy of a video once Postiz has it and lets unused clips go, for Railway's
5 GB disk. Tested here end to end with the real server program and Chrome: a batch of 4 made, H.264 1080x1920 30 fps
+ AAC, colours matching the clips, sent through a stand-in for the posting function (+ `serverBank.test.ts`,
`serverLink.test.ts`). Not tested here: Railway itself, and his own 4K clips on it.

## Fix: laggy hooks - a trimmed reaction no longer starts in its hidden lead-in
Only ./deploy.sh is needed. Videos already made stay as they are; new ones from the same reactions are fine.
**What was wrong:** his reactions are trimmed on the iPhone, and a trimmed clip keeps the frames from the key frame
before the cut - only every other one - marked never to be shown. Photos and every player skip them; the Cutter read
the clip as starting at the first of them, so a hook opened on up to 0.8 s of what he had cut away, at half the frame
rate: laggy, then normal. The reports from his Batch tab showed it: the 8 reactions rejected every time held 20-24 of
those hidden frames, the ones never rejected 0-7.
**Fix:** every clip starts where its picture is shown, never before 0 (`clipParts.firstShown`, used by `openClip` -
every batch and joined clip - and by pop-up videos). Reproduced with a trimmed file (`fixtures/trimmed.mov`, +
test). The reaction report now also says how many hidden frames a file holds.

## Laggy hooks: watch every reaction, see which ones he rejects, frames by timestamps only
Only ./deploy.sh is needed.
**What was wrong:** of 40 batch videos, every video from 8 reactions (IMG_0250-0253, 0257, 0261-0263) was laggy and
rejected, every video from 8 others was fine - same filming, and the files play smoothly in Photos. So it is something
in those files that the making trips on. The steady 30 fps drew each clip frame until "its end" as the file states it;
a file that states its frames longer than they are had frames skipped and others held.
**Fix:** each steady frame now shows the clip's frame on screen at that moment by the frames' own timestamps alone - a
frame stays until the next one starts - never by the length a file states (both batch layouts).
**New in the Batch tab:** tap any reaction, product or step clip to watch it full screen, with "Take it out" right there.
A reaction whose videos he rejected says so next to it in orange ("3 videos, 3 rejected").
**Finding the cause for sure:** opening the Batch tab now reports, once per reaction file, what it is made of - codec,
size, turn, colour, frame rate, how evenly its frames are spaced, the length it says each frame lasts, whether its frames
are stored out of order, and how many of its videos were rejected (`cutter_errors`, phase "reaction").
**How:** `montageRender.ts` / `greenScreenRender.ts` keep the frame on screen (`shown`, a clone) and draw it on every
steady frame before the next one starts; `clipCheck.ts` (`frameTiming`, `describeClip`, + tests); `batch.madeWith`;
`ClipViewer.tsx`; `BatchView` (tap a name, the orange count, the report).

## Batch videos: a steady 30 frames a second, and the words a little lower
Only ./deploy.sh is needed. Videos already made keep their old frames: only ones made after the update change.
**What was wrong:** some batch videos stuttered at the start once posted, though they played smoothly in Posts. A batch
video took its clips' frames as they came: a screen recording's uneven ones, a reaction at another frame rate, a first
frame that arrives late. The platforms re-encode every upload to a steady rate, and an uneven start is where that shows.
**Fix:** every batch video (both layouts) is now made at a steady 30 frames a second from its very first moment: each of a
clip's frames is drawn on every steady frame before its end (a 60 fps recording's every other frame, a slower clip's
twice). 30 fps is also less work for the phone than 60. The hook, the step names and Claude + X sit 4% of the height
lower than the angle's headline ("i want the text to be a little lower"), never into the caption at the bottom.
**How:** `montageRender.ts` `FPS`, `framesBy`, `BATCH_LOWER`, `lowered` (+ tests in `montage.test.ts`); the montage
and `greenScreenRender.ts` loops draw on the steady frames. Talking videos are unchanged.

## Each posted video's views, for the planner's views tracker
Needs deploying: run ./deploy-server.sh (the database field is already added).
**What:** the server now reads each posted video's views from Postiz, per account, a day, three days and a week after
it went out, and keeps them on the post (`cutter_posts.views`, by account name). The planner reads them for its new
views tracker: each campaign can have a minimum views per video, and a video counts once any one account it went to
reaches it. One video is read per tick, so posting never runs short of Postiz's hourly allowance.
**How:** `postiz/postViews.ts` (`postViewsDue`, `postViewCount`, `accountNameFor`, + tests); `refreshPostViews` in the
tick (GET `/analytics/post/:postId`; a 429 waits for a later tick; an answer it can't read keeps a sample in
`cutter_config` `postviews:unread`); fake Postiz answers it in test mode. Migration
`20261019120000_cutter_posts_views.sql` (shown to and OK'd by the owner, applied 2026-10-19).

## Fix: the tab bar sliding with the scroll (the zoom)
Only ./deploy.sh is needed.
**What was wrong:** on an iPhone, tapping a text box whose writing is smaller than 16 px zooms the whole screen in - and
while it's zoomed, a bar fixed to the bottom slides with the scroll instead of staying put, until the zoom goes. The
Claude + X "Amount a day" boxes were 13 px, so it came and went depending on what was last tapped - "sometimes".
**Fix:** the page no longer zooms in when a box is tapped (maximum-scale=1 on the campaign page), every text box is at
least 16 px, and the two amount boxes have proper 16 px writing. If the screen ever zooms anyway, the phone now sends a
short report saying which box it was (cutter_errors, phase "zoom"), so a next cause is found, not guessed.
**If it still slides after ./deploy.sh and closing/reopening:** delete the Cutter icon and add it again from Safari
(Share, Add to Home Screen) - an icon added before the Oct fix can keep the old see-through status bar that sets off
iOS 26's own bug (WebKit 301108). Nothing is lost: videos and settings live in the site, not the icon.
**How:** `campaign.html` viewport, `campaign.css` (`:where(...)` 16 px, `.formula-range input`), `zoomWatch.ts`
(+ test). Checked in a phone-sized Chromium that no text box on any tab is under 16 px; not on an iPhone.

## Claude + X captions: no more "IMG 0373 + IMG 0374"
Only ./deploy.sh is needed.
**What:** the Claude + X logos' names came from their file names, and phone photos are called IMG_0373 - so the words
given to Claude for the caption were "IMG 0373 + IMG 0374 = $800 daily", and it wrote captions like "two random
screenshots on my camera roll turned into an app". Now a file name that says nothing (IMG_…, Screenshot…, PXL_…) is never
used: the caption gets just the amount, and under the logo buttons a small "The left logo is" box (e.g. Claude) shows -
only for a logo whose file name doesn't say what it is. Type it once and the captions say "Claude + Lovable = $800 a day".
Videos already scheduled keep their captions (Start over remakes them).
**How:** `batch.logoName` ignores camera/phone names (`SAYS_NOTHING`); `formulaText` says only the amount until both
logos are named; BatchView `leftName`/`rightName` fields; `mixPrefixes` reads the amount from either form. Tests in
`batch.test.ts`, `batchView.test.tsx`.

## Batch: Start over
Only ./deploy.sh is needed.
**What:** a **Start over** link in the Batch tab (next to Stop, once a batch has videos not out yet). It asks first,
then takes out every video of the batch that hasn't gone out - videos still waiting to be made, and posts scheduled
but not posted (stopped in Postiz too, the way Posts stops them). Those mixes can be made again, with whatever you've
set now (the fixed sound, Outline steps...). A mix matching a video already posted is never made again. Your clips,
headlines, songs and settings stay; the batch stops, and Start makes the week again. Use it instead of deleting the
batch: deleting clips would block them from coming back (they made videos), and the week would still count as full.
**How:** `batchRun.startOver` (dayVideos, stopPostsNow, `countedDays` for what is left); `batch.mixPrefixes` reads a
video's mix back from its file name and headline, `batch.unmake` frees the taken-out ones but never one matching a
posted or still-going-out video. Tests in `batch.test.ts`, `batchRun.test.ts`, `batchView.test.tsx`.

## Set order: step names as long as you want
Only ./deploy.sh is needed.
**What:** a step's name (the words written over its clip) was cut off at 40 characters. Now there is no limit: type as
many words as you want. The box grows to show them all (a long name takes the whole row, with its buttons under it).
On the video, a name too long to fit gets smaller so every word stays on screen - it never covers more than about half
the screen. Enter just closes the box; a line break typed or pasted becomes a space. Normal headlines are unchanged.
**How:** `StepOrder.StepName` (a growing textarea, no maxLength); `overlay.layoutHeadline` shrinks any block taller
than `MAX_BLOCK` (45% of the frame). Tests in `stepOrder.test.tsx`, `overlay.test.ts`.

## Batch: the music is one unbroken track over the whole video
Only ./deploy.sh is needed.
**What:** the music under a batch video was still written piece by piece, following each clip - so it was tied to the
cuts. Now it is laid over the finished video as one continuous track, from the first moment to the very last frame,
with nothing to do with where the clips change: no cut, dip or pop in the music at any cut. The clips' own sound isn't
even read any more (it was never heard). It is laid down as the picture goes rather than after it, because the file is
written as it's made - holding the music to the end would keep every frame in the phone's memory first.
**How:** `montageRender.musicTrack` writes the music from one running position up to each frame's end, then to the end
of the last frame; `writeWhole` takes no `onSound` for it and skips the clip's sound. Tests in `montage.test.ts`,
`clipJoins.test.ts`.

## Batch: no pop at clip changes; Outline on the product demo and Claude + X; used clips never come back
Only ./deploy.sh is needed.
**The pop at every clip change:** each clip's sound was cut to exactly its length, but its last frame runs a little
longer (up to 1/30 of a second), and the next clip started after the frame - so the soundtrack had a tiny hole at every
change, where the music dropped out and came back: the pop. The sound now runs right up to the end of each clip's
picture, so the music plays straight through. Same fix for Join and for clips before/after a talking video.
**Text styles:** the step names (the product demo) and the Claude + X amount are always in the Outline style now.
Snapchat (and the white box) only ever goes on the hook headline, on its own. The Claude + X preview in Batch shows it
outlined too.
**No duplicates, ever:** every top-up of a campaign's batch already shares one list of what was made, so a used mix is
never made again. But a clip taken out after videos were made from it - or cleared out once everything was made - could
be added back and make the same videos again. Now those clips are remembered by what's in them, and adding one again is
refused: "old-reaction.mov was already in videos you made, so it wasn't added again - film new ones to make more."
Songs and headlines can come back (with new clips they make new videos).
**How:** `clipParts.writeWhole` fills the sound up to the picture's end (`clipJoins.test.ts`); `batch.ONLY_HOOK_ELSE`
for step titles and `layoutFormula` in `montageRender`; `BatchBank.usedClips`, `clipKey`, `rememberUsed` (on take-out,
step removal and `spend`), checked when adding. Tests in `batch.test.ts`, `batchView.test.tsx`.

## Batch: you're told when the last videos are made
Needs deploying: run ./deploy-server.sh (and ./deploy.sh).
**What:** when a batch makes the last different videos your clips can make, its usual "N videos ready to approve"
notification becomes "Lovable: the last 3 videos - film new clips", saying the days they post and that the batch stops
after them. The Batch tab still shows "Time to film new ones" once they're made.
**How:** `batchRun.planVideos` marks the videos of the plan that spends the bank `batch.last`; the server keeps it
(`batchInfo`) and `notifyBatch` words the notification with `batch.batchReady`. Tests in `postiz/batch.test.ts`,
`batchRun.test.ts`.

## Batch times: no more piling up at 11 AM, and full days that change each day
Only ./deploy.sh is needed.
**What:** 11 AM is the start of the posting day (11 AM - 6 PM, the middle of the day you asked for), but batch videos
were stuck to it more than they should have been:
- When a batch needed more times than the campaign's own (say 3 a day on a campaign set to 11:00 and 6:00), the extra
  went to the first free time - about 11:30, right after the first. It now goes somewhere in the open part of the day,
  a different time each day (2:40 PM one day, 4:10 PM the next).
- Adding videos to a day that already had some did the same; they now spread over what's free.
- A full day (24 a day) sat on the same grid every day - 11:00, 11:17, 11:34 ... 5:50. A quarter of the day now stays
  free, so the times and the gaps between them change every day (gaps of 10 to 30-odd minutes). With 24 a day it still
  starts around 11:00-11:05: 24 videos only fit in 11 to 6 if it starts at the opening.
- Adding to a day now really keeps 20 minutes clear of the posts already there when there is room (it used to squeeze
  to 10).
**How:** `batch.spreadPick` (one per stretch of the candidates, seeded by campaign and day) replaces the even pick that
always took the first candidate, in `batchTimesOn` extras, `stackTimesOn` and `runSlots`; `posting.batchGap` keeps a
quarter of the window as slack; `stackTimesOn` takes the number still needed and a `usable` filter instead of 25 then
filtering. `window.spanOf` (server behaviour unchanged). Tests in `posting.test.ts`, `batch.test.ts`.

## Batch: hooks in shares you choose, Claude + X mixed in with the headlines
Only ./deploy.sh is needed.
**What:** the Batch tab's Hook section now has four buttons: **White box / Outline / Snapchat / Claude + X**. Tap any
of them to turn them on together (one always stays on). With more than one, each gets a row with **− 25% +**: they
start even, and + gives that hook more of the videos (Snapchat at 50% and the other two at 25% means half the videos
are Snapchat). Claude + X can now be one of them: those videos show the two logos and an amount, the others a headline
in their look - same batch, same reactions and products. The Headlines list shows while a headline look is on, the
logos and amount while Claude + X is on.
A Claude + X video counts as different for each amount in its range ($500 to $1,000 is 11 amounts), the way each
headline does, so no two videos are the same. The variations box at the bottom says so: "21 hooks (5 headlines in 2
looks + 11 Claude + X amounts)". A batch that is Claude + X alone works exactly as before.
If one hook runs out of different videos before the others, it stops until you add new footage, and the others carry
on. With only 2 reactions the shares can drift a little, because the same reaction never plays twice in a row.
**How:** `BatchBank.looks` (`LookShare`: look + parts), read through `looksOf` (old `hook`/`headlineStyles` too);
`looksToMix` builds the hook dimension (headlines x headline looks + `formulaAmounts`); `pickBatch` takes the look
furthest behind its share, then the best combination in it; `BatchPick.look/amount`; `planVideos` gives Claude + X picks
`formulaLine(…, amount)`. `BatchView.HookLooks`. Tests in `batch.test.ts`, `batchRun.test.ts`, `batchView.test.tsx`.

## Batch: several headline looks at once, and the number of variations at the bottom
Only ./deploy.sh is needed.
**What:** under a batch's Headlines, White box / Outline / Snapchat can now be on together - tap one to add it, tap it
again to take it out (one always stays). With more than one, the videos take turns: the same headlines in each look,
evenly - with all three, a third of the videos in each (15 videos: 5 Outline, 5 Snapchat, 5 White box). Every headline
comes in every look, so each look counts as more different videos. Step names follow each video's look.
At the very bottom of the Batch tab: **"360 variations"** with what multiplies into it ("4 reactions × 3 product
showcases × 5 headlines × 2 songs × 3 headline looks") and how many are still to make, with the days that lasts. It
replaces the "X of Y different videos left" line, and shows even when Videos a day is 0.
**How:** `BatchBank.headlineStyles` (`stylesOf` reads the earlier single `headlineStyle`); `pickBatch`/`combos` add the
look as a dimension only with two or more (`stylesToMix`) so one-look banks keep their keys; `BatchVideo.headlineStyle`
-> `montage.bank.headlineStyle`; at render `styleFor` keeps it while still picked, else one picked now (a change reaches
videos not made yet). `batchRun.variationParts`. Tests in `batch.test.ts`, `batchRun.test.ts`, `batchView.test.tsx`.

## Headline style (Snapchat, Outline, White box) picked right where the headline is written
Only ./deploy.sh is needed.
**What:** the Snapchat look was only in Campaigns -> the angle -> Headline -> Style, so it was easy to miss. Now the
three looks (White box / Outline / Snapchat) sit right under the headline in two more places:
- **Videos tab:** open a video waiting to be approved; under its Headline box, tap the look for that one video. It
  starts on the angle's look.
- **Batch tab:** under the Headlines list, tap the look for every video of the batch. The step names (Set order) use
  the same look. It is read when each video is made, so it reaches every batch video not made yet; videos already made
  keep their look.
**How:** `look.HEADLINE_STYLES` (shared with the angle editor) and `withHeadlineStyle(angle, style)`; per video
`day.headlineStyle` (`CampaignApp.setHeadlineStyle`), per batch `BatchBank.headlineStyle`; the render loop swaps the
angle's headline style for whichever is set (the video's first) before any make. Picker: `JobRow.HeadlineLook`. Tests in
`headlineLook.test.tsx`, `batchView.test.tsx`.

## Batch: each step's name written over its clip, as a headline
Only ./deploy.sh is needed.
**What:** in a batch with steps (Set order), every video now shows each step's name over that step's clip, in the same
headline text as the reaction's (TikTok font, the angle's headline look): a step named "DRAW SOMETHING" puts "DRAW
SOMETHING" over its part of every video, exactly as typed. A step still called "Step 1", "Step 2"... shows no words -
rename it to have some. Videos already planned get it too (their step names are looked up from the campaign's steps).
The Batch tab says under each step what will be written.
**How:** `batch.stepTitle`; `BatchVideo.steps[].name` (set by `batchRun.planVideos`), `MontageParts.bank.steps[].name`;
`makeMontage`/`renderMontage` `titles` per clip, laid out with `layoutHeadline` in `look.headline` and drawn for the
whole clip. Tests in `batch.test.ts`, `batchRun.test.ts`.

## Pictures side by side; pictures fully editable in the editor; Analytics only for batches
Only ./deploy.sh is needed.
**Pictures side by side:** pictures that come up together - one word bringing up two (give two pictures the same words
in the angle's Pictures, or two bank pictures share a word), or two put on by hand at the same moment - now sit side by
side in one row, the same height, inside the frame, instead of on top of each other. Before, the bank showed only the
newest, and two angle pictures overlapped.
**Pictures in the editor (cuts/captions page):** the controls were there but at the very bottom, under every caption
phrase - so a picture put on by mistake looked impossible to remove. Now tapping a picture (on the video, the timeline,
or the new row of picture chips under the buttons) opens it right under the video:
- **Delete picture**.
- **On screen for** − / + (half a second at a time, 0.5 to 20 s).
- **Size** slider (8% to 100% of the width), or pinch it on the video.
- **Drag it on the video** anywhere you like (**Put back** returns it to its usual spot).
- **Start it here**: moves it to where the playhead is.
What the video shows while you edit is exactly where it lands in the finished video.
**Analytics:** only your batch campaigns now (Lovable, OpenArt - any campaign with a batch); your other accounts are
gone from it, and so is the account-by-account list. Each card: videos a day, views a video, the trend on last week,
and the "Ready for N a day?" suggestion right in the card.
**How:** `overlay.cameUpTogether` (within 0.35 s), `sideBySide`, `layoutLogo` `center`; `render.ts` draws angle and
bank pictures in groups. `ManualPicture.center`, `PICTURE_SECONDS`, `PICTURE_WIDTH`, `previewBoxes` (the render's own
layout, for the preview); `CutsEditor` panel `.pic-edit`, chips, pointer drag/pinch on the selected picture.
`AnalyticsView`/`useCampaignRows` keep campaigns with a batch only. Tests: `overlay.test.ts`, `cutsPictures.test.tsx`,
`analyticsView.test.tsx`.

## Captions: every sentence keeps its first and last word, and shows them long enough to read
**What:** captions were losing words at the edges of sentences. Each sentence is its own kept stretch (the pause
between is cut), and the speech model times edge words a little off:
- A word **starting in the last 0.1 s** of a stretch was dropped outright - the "a bit early" allowance shifted it
  past the end, where no other rule caught it. In a simulation of 600 sentences with the model's real timing error,
  53 lost their last word this way. Now 0.
- A sentence's last word heard up to half a second after the cut is kept when it carries the sentence on (the word
  before it didn't end one) - before, only the rougher timings got that much room.
- A sentence's first word timed just before its stretch (short ones: "And", "I", "So") is kept when it ends within a
  quarter-second of it and the sentence before has ended.
- The last words of a sentence were squeezed into its final 0.1 s, two or three frames. Each now gets at least a
  quarter-second (the earlier words move up a touch to make room); in the simulation, last words on screen for under
  0.2 s went from 30 to 2.
**How:** `captionWords` (captions.ts): in-stretch test no longer shifted at the end, `EARLY_END_SEC` for first words,
the half-second late window when the sentence hasn't ended, and a per-stretch `READ_SEC` tail fit after the in-order
pass. Tests: the old "drop a late last word" expectation now keeps it; new cases for an early first word and readable
last words.

## Formats tab: drop in your takes, get them made, send them to the brand, schedule the week
Needs deploying: run ./deploy-server.sh (scheduled videos skip approval), then ./deploy.sh.
**What:** a new **Formats** tab (next to Videos).
- **Pick the campaign, tap + New format, name it** (e.g. "Morning routine"). Its editor opens: set its look like any
  angle and, under **Clips**, the clips joined onto every take - intro before, product demo or outro after, clips in
  the middle at a phrase.
- **Open the format, tap + Add takes** and pick all the takes you filmed for it. Each one becomes its own video: cut,
  captioned, joined with the format's clips, with its headline and logo - like the Videos tab, but no sorting and no
  approving in between.
- **They wait in the format, not posted.** Tap **Watch** to check one, **Save** (or **Save all to my phone**) to put
  them in your Photos/Files and send them to the brand. They're kept on the phone until you schedule them - closing
  the app doesn't lose them.
- **Brand said yes?** Tap **Schedule for the week** or **Next 5 days**: the videos are spread as evenly as possible
  over those days (it shows which days before you tap), at the campaign's posting times, clear of what's already
  there. They post by themselves - no approving again - and show in Posts like any post.
- A take that fails shows **Try again**; ✕ takes one out. If the headline/caption look fails on one, you still get a
  plain cut (marked).
**How:** formats are angles with `isFormat` (never used to sort a day's videos; no "Recognise it by"). Takes are jobs
with `forFormat`: listened to for captions, then made straight away (`approved`), and when made `holdFormat` keeps the
finished MP4 (`store.holdMade`, `held:<id>` in the videos table) with the transcript/headline/duration, instead of
sending. Held videos never expire; their recording goes after the 2 h edit window. `scheduleFormat` spreads them
(`formats.spreadOver`, `perDayCounts`) and queues each with `meta.batch` + `meta.scheduled`; the server's
`approvalFor` makes a scheduled batch video `direct`, so it goes at its time. `FormatsView.tsx`; tab bar now 7 tabs
(10 px labels, iOS's own size). Tests: `formats.test.ts`, `formatsView.test.tsx`, `postiz/batch.test.ts`.
**Not checked here:** making real videos (this browser can't encode H.264) and the iPhone share sheet with several
videos at once - the store keeping is typechecked, not run.

## Analytics tab: views per video, the trend, and "ready for more a day?" - one tap
Needs deploying: run ./deploy-server.sh (the server reads the views), then ./deploy.sh.
**What:** a new **Analytics** tab (between Batch and Campaigns):
- **Each campaign:** its views per video (its accounts averaged) and how that moved on last week, then each account
  with its views per video, followers, trend and when it was last read.
- **Suggestions you answer with one tap:** when a running batch's videos are doing well - views per video up a fifth
  on last week, or at the number you set - a card says "Inflow: ready for 4 a day?" with **Yes, 4 a day** and
  **Not now**. Yes changes Videos a day and the week ahead follows at once (like the + on the Batch tab). If views
  fall by almost a third it suggests one fewer (unless you're still at your number). Steps are small - one a day,
  two once past five - never past 25, and after you answer it leaves that campaign alone for 3 days so the new rate
  can show. A blue dot on the tab means a suggestion is waiting.
- **Your number (optional), per campaign:** "Suggest more a day at [1000] views a video". Empty: it goes by the
  trend only. Both count: up a fifth OR at your number.
**Where the views come from:** Postiz reads them from the platforms. TikTok: the total views of your last 20 videos,
over how many (so views per recent video). Instagram, YouTube: views over the last 7 days, over the videos the Cutter
posted there. The server reads one account every few minutes, each about once a day, so it never uses up Postiz's
hourly allowance that posting needs; with ~20 accounts the first numbers fill in over the first hour or two after the
deploy. Postiz only has views from when an account was connected; brand-new accounts may show nothing for a few days.
**How:** server `postiz/views.ts` (`readViews` per platform, `remember` one reading a day for 60 days, `notRead`
retries in 6 h, `dueAt`), `index.ts` `refreshViews` in the tick (the stalest account a campaign posts to, one
`GET /analytics/:id?date=7` a tick; a 429 is left for the next tick) and the `views` action (login-checked), cache in
`cutter_config` `views:<profile>`. Phone: `analytics.ts` (`weekChange`, `campaignViews`, `suggestRate`, `stepFrom`,
answers per campaign), `AnalyticsView.tsx` (`useCampaignRows`, `answerSuggestion`, `saveTarget`), `posting.listViews`,
`BatchBank.viewTarget`, `TabBar` dots. Lowering moved to `batchRun.trimDown`, so the app's own batch runner now
lowers days too (a "fewer a day" yes applies at once, whatever tab is open). Tests: `views.test.ts`,
`analytics.test.ts`, `analyticsView.test.tsx`.

## Headline: Snapchat style
**What:** a third headline style, next to White box and Outline: **Snapchat** - white words on a see-through black
band right across the video, the way a Snapchat caption looks. Pick it in the angle's Headline -> Style; Where and
Size work as for the others, and batches made with that angle use it. On the iPhone it is drawn in Apple's own font,
as Snapchat's is. Only ./deploy.sh is needed.
**How:** `look.HeadlineStyle` 'snap'; `overlay.layoutHeadline` (system font, smaller sizes, a band's padding kept
below TikTok's tabs) and `drawHeadline` (one `fillRect` the canvas's full width at 60% black, then white text);
`Editors` STYLES. Test in `overlay.test.ts`.

## Batch: change videos a day any time - up, down, or 0 to pause - and it follows at once
**What:** while a batch runs, change **Videos a day** whenever you like and the week ahead follows straight away:
- **Up** (2 -> 10 -> 25): the extra videos are added to the days already made, as before.
- **Down** (25 -> 2): the extra videos come back out of the days ahead, leaving the rest spread through each day.
  Ones not made yet are dropped; ones waiting or scheduled are stopped, the same way Posts stops them. One already
  posted, or being made right that second, stays.
- **0**: paused. Everything not out yet comes out, nothing new is made, your clips and what's left to make are kept.
  Raise it again and it picks up from there - no need to tap Start.
- **Tap the number to type it** (2 to 25 in one go) instead of tapping + 23 times. The +/- still work; quick taps
  make one change, not one per tap.
On the engine, lowering also stops the batch it is making, then hands it the days again at the new number.
Only ./deploy.sh is needed.
**How:** `batchRun.ts` `overfull`, `dayVideos` (server posts + jobs here, one per key), `trimPlan` (keeps an even
spread; never posted, never the job being made), `countedDays` (after the engine is stopped). `BatchView.runTrim`
(`WhenDue`, before any top-up); 0 allowed (`BATCH_MAX_PER_DAY` still the top); the number is an input. Tests in
`batchRun.test.ts` and `batchView.test.tsx` (lower, pause, typing 25).

## Batch: no more Days - pick videos a day, tap Start, it keeps going
**What:** the Batch tab's Posting is now just **Videos a day**. Days and the "On top / After" choice are gone. Tap
**Start**: the next 7 days are made straight away. After that, every time you open the Cutter, the batch makes the
days it's missing by itself - no tap - so there's always a week of videos waiting. It stops on its own once every
different video your footage can make has been made (you get "Time to film new ones", as before), or when you tap
**Stop**. Raise Videos a day and the days already made get the extra ones too (clear of their times); lower it and
the days not made yet get fewer. It says how many different videos are left and how many days that lasts. Same on the
engine: each top-up is handed to it. Every video still waits in Posts for your approval. Batches you made before keep
their days; tap Start once to keep them going. Only ./deploy.sh is needed.
**Good to know:** the phone layouts still make videos only while the app is open (as before) - now it just happens
without you asking. The engine makes them with the app closed.
**How:** `batchRun.ts`: `runSlots` (every day from today through a week, up to the number; empty days take the
campaign's batch times, part-filled days `stackTimesOn` clear of their times), `planVideos` (mixing moved out of
`BatchView.make`; caps at the different videos left, spends and stops at the last), `topUp` (saves the bank, then
queues or hands to the engine; failures kept in `runProblem`). `BatchBank.running`, `filled` (count per day; old days
count as `lastPerDay`). Top-ups: the Batch tab for its campaign (`WhenDue`, 1.2 s after the last change), and
`CampaignApp` for every running campaign when the app opens, comes back on screen and every 30 min; `oneAtATime` /
`settled` keep them from overlapping. `planSlots` and the stacking UI are gone. Tests: `batchRun.test.ts`,
`batchView.test.tsx` (Start, Stop, top-ups, old batches).

## Batch: no seconds to set - each step plays the moment something happens in its clip
**What:** **Set order** is now just the step names and their order; the seconds boxes are gone. When a video is made,
the Cutter looks at each step's clip and plays the moment something happens in it - a scroll, an answer appearing,
typing - from just before it starts to just after it settles (2-5 s).
- A clip with several moments: different videos play different ones, the bigger ones more often.
- A long moment (a minute of typing): 3-5 s of it, from a different place in each video.
- A clip you trimmed to 4 s or less: plays whole.
- Nothing stands out (all still, or filmed footage moving the whole time): a random 2-3.5 s of it.
- All the steps together never run past 12 s (each shortened evenly, none under 1 s).
Steps you already set keep their names and clips; the seconds typed before are ignored, and videos already planned
use the new way when they're made. Only ./deploy.sh is needed.
**How:** `stepPiece.ts`. A still frame is stored in a few bytes and a changing one in many, so the clip's frame sizes,
read from its index (mediabunny `EncodedPacketSink`, metadata only - no picture decoded, a few ms even for a long 4K
clip), show when something happens: `activityOf` (bytes per quarter second, key frames counted as ordinary frames,
smoothed), `momentsOf` (above 25% of the way from the quiet level to the busiest, gaps under 0.75 s joined; none unless
the busiest is 2.5x the quiet), `pickPiece`, `fitShowcase`. `montageRender` `windows` is now true/false per clip;
`BatchStep` has no `minSec`/`maxSec`. Tests: `stepPiece.test.ts` (including an MP4 written and read back). Checked on
ffmpeg-made H.264 and HEVC clips: a scroll at 3-5 s found at 2.75-5.25 s; still and always-moving clips find none.
**Also:** AGENTS.md now opens with the rule behind every feature - least input from him, most output from the app.

## Fix: Edit again takes the post out of Posts until the new version is ready
**What:** tapping **Edit again** on a post now takes it off the Posts screen (and out of the "to approve" count) right
away. It stays off while you edit and while the new version is made; the new version shows up in Posts once it's made
and sent, replacing the old one. If the old one was already scheduled in Postiz, it's taken back out while you edit,
so the old version can't go out in the meantime. Remove the edited video from the list and the old post comes back.
One already posted stays, as before. Same for batch videos (new headline / track).
**How:** `posting.isBeingRemade` (+ `remade.test.ts`): a post whose key a job `replaces`, not gone out yet.
`PostsView` `remaking` (filters it out of every list), `CampaignApp` `remaking` / `remakingRef` (also the count),
`holdWhileRemade` (unschedules a scheduled one) on Edit again and on a batch remake.

## Fix: headlines with emoji centred, and never off the sides
**What:** on the iPhone an emoji is drawn wider or narrower than Safari says it is, and a headline with one could come
out off to one side - sometimes. The headline is now laid out on how it is really drawn: where lines break, how wide
each is, and where its middle is. A line that still can't fit (one long word, a row of emoji) makes the headline a
little smaller instead of running off the edges. Only ./deploy.sh is needed.
**Why "sometimes":** the centring already drew each line once to find its real middle, but (1) where lines broke still
used Safari's width, so a line could come out too wide; (2) the scratch canvas was sized from that width too, so a much
wider emoji was cut off and centred wrong; (3) the first emoji drawn could come out missing. All three are fixed.
**How:** `overlay.ts` `layoutHeadline` (wraps on drawn width for lines with emoji, shrinks to fit, up to 3 tries),
`inkOf` (room for the widest it could be, draws twice, retries wider if the ink touches the edge). Checked in Chromium
with real emoji (every line centred to the pixel, before and after - the bug is Safari's), and a test for the shrink.

## Batch: product showcase in steps (Set order), and the reaction zoom really on batches
**What:**
- **Set order** (Batch tab, next to the campaign): name the steps of the campaign's product showcase in order - e.g.
  "Claude", "The app", "The prompt" - up to 10, each with how long it plays (2-3 s to start; 1-15 s). Save order,
  and the product showcases become one list per step ("1. Claude", "2. The app"...): add as many clips to each as you
  like. Every video plays the reaction, then one clip from each step in your order - a random few seconds of it, from
  a random place - with the song over all of it (the step clips are muted).
- **Many more different videos:** each step is its own choice, so 5 reactions x 4 clips in each of 3 steps x 20
  headlines x 5 songs = 32,000 combinations before the random slices; each is made once before any comes again, and
  every clip comes round evenly. Big banks are picked in a moment (it stops listing every combination past 20,000 and
  takes the least-used of each part, still never repeating one it remembers).
- Each campaign keeps its own order. Campaigns with no order set work exactly as before (one list, each clip whole).
  Taking a step out takes its clips with it (asks first if it has any). When every combination is made, the clips go
  (film new ones) and the step names stay. Green screen and the engine don't use steps yet.
- **The reaction zoom now reaches batch videos:** the last update only zoomed reaction videos made one at a time - the
  Batch tab makes its videos another way. Now every batch reaction slowly zooms in too (8%, under the headline or the
  formula).
Only ./deploy.sh is needed.
**How:** `batch.ts`: `BatchStep`, `usesSteps`, `cleanStepSeconds`, `stepWindow`, `filesOf`; `pickBatch` / `combos`
generalised to any number of product lists (keys unchanged for banks without steps), `MAX_COMBOS` 20,000, unlisted banks
remember 5,000 made, `spend` keeps step names. `StepOrder.tsx` (the sheet); `BatchView` (Set order button, step lists,
`add` to a step, `takeOutOfStep`, `saveOrder`); `store.ts` `MontageParts.bank.steps`, cleanup via `filesOf`;
`clipParts.writeWhole` `window`; `montageRender` `windows` (seeded per video) and `reactionFirst`; `pipeline.makeMontage`,
`CampaignApp` (clips, windows, names). Tests in `batch.test.ts`.

## Batch: every reaction slowly zooms in
**What:** (Reached only reaction videos made one at a time - batch videos got it in the next update.) Every reaction now has a slow zoom-in for its whole length -
the full frame at the start, 8% closer by the end, easing in and out. Only the video moves: the headline (or the
formula) stays still on top. Always on, whatever the angle's effects say; where the angle's own "Push-in under the
hook" is on and closer, that one shows. Green screen and the engine are as they were. Only ./deploy.sh is needed.
**How:** `effects.ts` `REACTION_ZOOM` / `reactionZoom` (+ test); `reactionRender.ts` takes the larger of it and the
angle's framing for the reaction stretch.

## Fix: no more click at every cut
**What:** every cut had a little click - the sound a video makes when it ends and starts. Now the sound fades out
over the last 8 thousandths of a second before each cut and back in over the first 8 after it: far too short to hear
as a fade, and the click is gone. The same where a video before / after / in the middle meets you, and where two
recordings are joined. Your music and pops/whooshes are untouched - they're laid over the finished video and play
straight through the cuts. Videos made from now on; ones already made keep their clicks (Edit again remakes one).
Only ./deploy.sh is needed.
**Why it clicked:** the sound is read in chunks of about 20 ms and each kept part took whole chunks - the one already
playing at its start and every one starting before its end - so at each cut the sound wave jumped from wherever one
part stopped to wherever the next started, and a few ms of the cut pause came along on each side.
**How:** `cutFades.ts` (+ test, which rebuilds a click from two joined chunks and checks it is gone): `cutEdges` (which
ends of each kept part are a cut - a gap, a video in the middle, the start and end of him; two parts with nothing
between them play on as one), `edgeGain` / `fadeAtCuts` (silent outside the part, 8 ms ramps inside it), `nearCut`
(only chunks at a cut are touched). `render.ts` fades his voice before the voice chain, the music and the sounds;
clip edges in `writeClip`; `joinRender.ts` at each join. The plain cutter is unchanged (rule 7).

## Captions: "Usual" sits a little lower
**What:** the Usual caption place is a little lower - its middle is now 66% of the way down the video instead of 63%
(about 58 pixels lower on a 1080x1920 video), still well above Bottom (80%) and TikTok's own caption. Every video
made from now on, and the caption preview, use it; videos already made don't change. Top, Middle and Bottom are as
they were. Only ./deploy.sh is needed.
**How:** `captions.ts` `CAPTION_Y` 0.63 -> 0.66 (+ test).

## End a campaign: its accounts come out of Postiz
**What:** a campaign's page (Campaigns, open it) has a new button under Stop all posts: **End campaign - free its
Postiz accounts**. For when a campaign is over, so its accounts stop counting toward your 30 in Postiz.
- Tapping it changes nothing yet: it shows what would happen - how many of its posts not out yet get stopped, which
  of its accounts come out of Postiz ("3 of your 28 connected accounts") and which stay, and why each one stays:
  another campaign posts to it, your friend's login uses it, another campaign's post is still due on it, a post went
  out on it in the last few hours, or Postiz holds posts on it that the Cutter didn't make. Then **End it and take
  out 3**, or Cancel.
- Ending stops all its posts at once and unticks those accounts from it; over the next few minutes the server takes
  its scheduled posts out of Postiz, then removes the accounts from Postiz. The page says "Taking 3 accounts out of
  Postiz..." and then what it did ("Taken out of Postiz: ...", anything kept and why, anything Postiz refused).
- **Removing means deleting from Postiz**: Postiz gives apps no way to just switch an account off (checked in Postiz's
  own code today). Videos already posted stay up on TikTok/Instagram/etc. To use an account again, add it in Postiz
  again (you log in to it there) - Postiz brings it back as the same account - and tick it in a campaign's Posting.
- An account kept for a reason that passes (a post still due, one just out, posts made in Postiz) stays ticked on the
  campaign, so ending it again later takes it out. Accounts a deleted campaign had ticked no longer hold anything.
- **Stop all posts** is unchanged (it only stops posts), so stopping a wrong batch never removes accounts.
Needs deploying: run ./deploy-server.sh, then ./deploy.sh.
**How:** `postiz/channels.ts` `endPlan` (pure, tested: which accounts may go and why the rest stay); `postiz/index.ts`
action `end-campaign` (no `confirm`: the preview; with `confirm`, the ids he was shown: `stopAll`, untick, a job in
the profile's `settings.ending`), `finishEnding` (after the request and on every tick: takes its stopped posts out of
Postiz, asks again, `DELETE /public/v1/integrations/:id`, retries when Postiz is busy, writes `settings.ended`,
re-ticks what stays for a reason that passes, refreshes the account list); `fake.ts` deletes a channel's posts.
Phone: `EndCampaign.tsx`, `posting.ts` `previewEndCampaign`/`endCampaign`, `CampaignsView`, `CampaignApp`.

## Settings tidied, dark mode finished
**What:**
- **Pause and daily limits** has its own page: Settings shows one row - "Pause and daily limits", saying what is paused
  or capped (or "Nothing paused, no daily limits") - and tapping it opens the list. There, each platform is one card:
  "All of TikTok" first, then each account (its @ name), each with its most-a-day number and a pause switch (orange
  when paused). Same settings as before, nothing changes in how they work.
- **Settings is shorter:** each section's rows sit together on one card with thin lines between them, like the
  iPhone's Settings (Posting, Default effects, Captions, Speech), instead of a card for every row. Default effects'
  three choices are one line each ("Punch-in at cuts ... Off"). Row names are in regular weight, as on the iPhone.
- **Dark mode:** the parts that were still drawn by the browser are finished - the limits' number boxes, the colour
  well, the angle's Look / Pictures / Sound / Effects / Clips switcher (now on its grey track), the sounds picker
  ("Your file..." on the same line), each effect on its own card, and numbers (-6 dB, 4.0 s) in the normal font
  instead of a code font.
Only ./deploy.sh is needed.
**How:** `PostingLimits.tsx`: `PostingLimitsRow` + `limitsLine` (+ `postingLimits.test.ts`) and the page
(`SettingsView` `limitsOpen`); `campaign.css`: `.limit-card`/`.limit-row`, `.card-group` (rows on one card, hairline
by a background gradient, `.field.inline` for a choice on one line), `.seg.parts` track over `--ink`, `.effect`
card, `input[type=color]`. Checked with screenshots in Chromium, light and dark, and a scan of every visible
control on Videos, Batch, Campaigns, Bank, Settings, the angle's five parts, New campaign and Posts for any left
with the browser's own look (none left).

## Batch 8: the engine - Ilyan's Le plateau on a server
**What:** big batches made on a server (Railway) instead of the phone, with Ilyan's engine: many videos from each
take, each a little different, never a near-copy, and the phone can be closed while it works.
- **Set up once:** the steps are in `engine/README.md` (a Railway project from this repo, a volume, an address).
  Then Settings, **Engine**: paste the address, **Connect** - it says how much room is left and whether Claude is on.
- **Use:** Batch tab, Layout **On the engine** (shows once the engine is connected). Add **Hooks - your face** (takes
  of 10-12 s; it cuts several hooks out of each), **Product clips**, **Headlines** (the words over the hook - Claude
  rewords them a little for each video) and **Songs** (each video gets the one this campaign used least, from its
  chorus). Pick the days as usual and tap Make: the phone sends what the engine doesn't have yet (once - after that,
  only new files), hands it the batch and is free.
- **Approving:** the videos arrive in Posts as a batch, each with its day and time, waiting for you - watch one, and
  if it's right, **Approve all**.
- The Batch tab shows how far it got (checked every 15 s), with **Stop** while it works and **Carry on** if it stopped
  (a restart, a failure) - nothing is posted twice. A video that would be too close to one already sent (last 30 days,
  90 for other campaigns) or to one in the batch is made again, up to three times, then skipped and counted.
- Rule change, OK'd by you: the bank's footage now leaves the phone - to the engine only, and only for this layout.
Needs deploying: run ./deploy-server.sh (the login function's new `whoami`), then ./deploy.sh.
**How:** `engine/` (Python 3.12 stdlib server + ffmpeg, Dockerfile, `railway.json`): `server.py` routes, `auth.py`
(token -> space via `cutter` `whoami`, cached 5 min), `uploads.py` (8 MB pieces), `series.py` (clips + settings ->
Le plateau `serie`), `jobs.py` (one batch at a time; keys `engine-<batch>-<n>`; token in memory only; `again`),
`guard.py` (dHash fingerprints every 0.5 s), `hooks.py` (Anthropic SDK 1.10.0, `claude-opus-5-5`, low effort, JSON
schema output, server-side fallback), `poster.py` (the phone's start / signed pieces / sent protocol to `postiz`).
`plateau/`: Ilyan's `remixer.py`, `sons.py`, `captions*.py` and TikTok Sans, unchanged (commit `f3c8678`), pointed at
`/data` by `plateau_paths.py`. Phone: `campaign/engine.ts` (+ test), `BatchView` layout `engine`, `SettingsView`
`EngineSetting`, `batch.ts` (`engineJob`). Tests: `engine/tests/test_engine.py` (14, with real renders and the real
SDK against a stand-in server). Checked here: renders are 1080x1920, 30 fps, about 15 Mbps.

## Batch 7: the look of Apple's own apps, light and dark, tips hidden
**What:**
- **Light and dark:** Settings, **Appearance**: Automatic (follows the phone), Light or Dark. Colours are Apple's own -
  grey ground, white (or dark grey) cards, system blue for the thing to do next, green / orange / red for done /
  look at this / failed - in both.
- **Tidier:** each section sits on its own rounded card; the switches are the iPhone's (Cut only / Campaign videos,
  every segmented choice, and on/off switches on the right instead of tick boxes); buttons are filled blue for the
  main one and light blue for the rest; links are plain blue; the tab bar is see-through like iOS; section names are
  small grey capitals like the iPhone's Settings; the Bank tab has one big title.
- **Tips off:** the explanations under settings and buttons (41 of them) are hidden unless **Show tips** is on in
  Settings, Appearance. Anything that says what is happening - warnings, "not synced", what is missing, progress -
  always shows.
- One thing that can't follow the theme: the iPhone's own status bar at the very top of the home-screen app stays
  black (it is set when the app is added to the Home Screen; changing it means re-adding the app, which can lose
  videos not yet sent).
Only ./deploy.sh is needed.
**How:** `theme.ts` (+ test): `data-theme` and `tips-on` on the page, set before the first paint in both `main.tsx`;
`index.css` tokens for dark (`:root`) and light (`prefers-color-scheme` / `data-theme='light'`), plus `--accent`,
`--field`, `--seg-track`, `--seg-on`, `--bar-bg`; an "Apple's own apps" block at the end of `index.css`,
`campaign.css` and `modes.css`; hard-coded colours replaced with tokens (`color-mix`). Explanations carry the class
`tip`. Checked with screenshots in light and dark in Chromium.

## Batch 6: green screen reactions
**What:** the Batch tab has a new **Layout**: **Reaction, then video** (as before) or **Green screen**. In green
screen, each video is the brief's video playing full screen with its own sound, and you, cut out of your background
(no box), reacting in a bottom corner - like TikTok's green screen effect. The video lasts as long as the background
video; a reaction shorter than that starts over, so film reactions as long as the backgrounds (up to a minute).
- **Reactions** are your clips; **Background videos** are the brief's (the product list, renamed in this layout).
- **Your corner:** Bottom left or Bottom right, and Size (25-50% of the width, 38% to start).
- **Headlines** are optional - none, and there's no headline. No music: the background's sound is the sound.
- Cutting you out happens **once per reaction**, the first time a video uses it ("Cutting you out - once per
  reaction" on the batch row), and is kept on the phone; every later video with that reaction reuses it. Taking a
  reaction out of the bank deletes its cut-out too.
- The first time, the phone downloads the cut-out tool (about 12 MB, from jsdelivr like the speech model).
Only ./deploy.sh is needed (it installs the new add-on).
**How:** new dependency `@mediapipe/tasks-vision` 1.0.1 (OK'd by the owner), its selfie segmenter model in
`public/models/selfie_segmenter.tflite` (250 KB), its engine fetched from jsdelivr at that version. `cutout.ts`
(`makeCutout`): every frame (at most 30 a second) at 540x960, mask steadied frame to frame and its edge softened,
kept as one MP4 with his frame on top and the mask under it; `store.ts` `saveCutout`/`loadCutout` (pieces in
`clipParts`, under the reaction's bank id, `CUTOUT_VERSION`). `greenScreenRender.ts` (`renderGreenScreen`,
`cornerBox`): background covers the frame, the mask half made see-through (`greyToAlpha`) and him drawn through it,
background sound to -14 LUFS under a limiter. `batch.ts` (`layout`, `corner`, `mixFrom`), `BatchView.tsx`,
`pipeline.makeGreenScreen`, `CampaignApp` (phase `cutout`). Tests: `greenScreen.test.ts`. The segmenter was run in
headless Chromium here (GPU, a 540x960 mask per frame); how well it cuts out a real person is checked on the phone.

## Batch 5: a video in the middle, when you say its words
**What:** an angle can now have **videos in the middle**: in the angle's **Clips** tab, tap **+ Video in the
middle**, type the words ("I'm going to show you how") and choose the clip. In every video of that angle where you
say those words, the clip plays right after them - whole, with its own sound, filling the frame - and then you carry
on. Not over you like a pop-up: in the timeline, so the video gets longer by the clip. If there's a short pause just
after the words, it goes in the pause; otherwise straight after the last word.
- The words are matched in what is kept of the take, whatever the case or punctuation; a phrase of four words or
  more may have one word misheard (never the first or last).
- Each video's Add list (on its row and on the edit screen) shows the angle's videos in the middle and says when a
  video doesn't say the words; untick **In this video** to leave them off that one.
- The finished row says "0:12 video in the middle", or that the words weren't said.
- Captions, pictures, sounds and music after the clip all move on with it; the music keeps playing under it.
- Not in the edit screen's preview yet - it plays your take; the clip is put in when the video is made.
Only ./deploy.sh is needed.
**How:** `cueClips.ts` (+ test): `findPhrase`, `placeCues` splits the cut where a clip goes (or uses the pause
within 0.35 s); `render.ts` `inserts` writes each clip with `writeClip` after its kept part, so every
`MomentPlacer` after it gets the new shift; `pipeline.make` places them (captions, else the words heard);
`clips.ts` `AngleClips.cues` (kept on this phone, counted as used); `JobClips.cues: 'none'` per video;
`ClipRow` takes a title and the phrase box; `ClipsField` shows the lines.

## Batch 4: cuts and captions on one page
**What:** a video's cuts and its captions are now one screen: the video at the top with the captions drawn on it,
the cuts timeline right under it (Split, Delete, Undo, + Picture as before), then the caption phrases, the look
settings and **Approve**. No more going back and forth between Cuts and Captions.
- **Play** plays only the kept parts, with the captions popping in - exactly the video that will be made.
- Tapping a phrase moves the timeline to it; its play button plays from there. While it plays, the phrase being
  said is lit and the list follows.
- Change a cut and, a moment later, the captions follow: words in a part you cut go, words in a part you bring
  back come back, and what you typed stays.
- **Cuts** on a video's row and **Check** both open this screen. The headline question before checking captions
  is unchanged. With captions off in Settings, Cuts opens the cuts alone as before.
Only ./deploy.sh is needed.
**How:** `EditScreen.tsx` (+ `editScreen.test.tsx`) puts `CaptionReview` (`embedded`: no video of its own) under
`CutsEditor` (`below`), draws the captions over its video (`paintOver`) and drives it through `CutsControl`
(seek, playFrom, repaint, subscribe). Cut changes settle `SETTLE_MS` (0.4 s) before `CampaignApp.followCuts`
applies them; `captions.withRestored` (+ test) brings back the words of a part put back; `keepEdit` keeps cuts and
captions together. `usePopStills`/`paintPopBox` shared from `CaptionReview` for the pop-up box.

## Batch 3: phone storage freed, the picker waits longer, fewer false crash reports
**What:**
- **Storage:** every sent video used to keep a copy on the phone until its post went out - a 120-video batch posting
  a few a day kept all 120 for weeks (one phone had 106 GB of Cutter storage the day a video stalled). Now the
  phone's copy goes as soon as Postiz has the video (scheduled). Watch, Save video and Add music then play Postiz's
  copy. Videos still waiting for you keep theirs, so they play at once with no signal. A full phone is what stops the
  iPhone handing picked videos over and gets the page restarted mid-video, so this should help both. Copies already
  there go the next time Posts is opened.
- **The picker:** most "nothing arrived" picks were slow, not lost - the video was made a minute or a few later. At
  15 s it now says "Your iPhone is still preparing the video" (and how to skip the wait: Format → Current) and only
  says it didn't come after 2 minutes. A late video is reported with how late it was.
- **Reports:** "EmptyRanges" and "Script error." (46 in three weeks) are Safari's own - in none of the app's code or
  libraries - and are no longer reported as app crashes. Once a day the phone sends a storage report (what is kept,
  counts and sizes only) so what is left can be found.
- **Stalls:** most came from 4K videos on builds before 2026-10-15 18:58; videos are 1080p since, and the stall
  watchdog already retries a stuck video. None since - watching the reports.
Only ./deploy.sh is needed.
**How:** `outbox.ts` (`copyDone`, used by `tidySends`; `sendsHeld`), `store.ts` (`storedCounts`),
`storageReport.ts` (kind `check`, phase `storage`, once a day, a minute after opening), `pickWatch.ts`
(`ARRIVE_MS` notice, `GIVE_UP_MS` 120 s, late pick reported as `check`/`pick`), `report.ts` (`safarisOwn`).
Tests: `copyDone.test.ts`, `pickWatch.test.ts`, `report.test.ts`.

## Batch 2: captions keep their first word
**What:** the first word of the captions (and sometimes the last) no longer goes missing, so it doesn't have to be
typed back in. Three causes, all fixed:
- **The headline cut the first phrase in half.** Captions start once the headline has gone - at that exact second,
  even mid-sentence, so "This app changed my life" came out as "app changed my life". Now captions start with a
  whole phrase: one mostly said after the headline is captioned whole (its first word can show as the headline
  goes), one mostly said under it is left out whole.
- **A soft first sound** ("so", "hey", "for") sits under the line the pauses are found with, so the kept stretch
  started a moment after the word and the word was dropped. A word whose sound runs on into the stretch is now kept.
- **The speech model missed the first or last word** of a take that starts the moment you talk or stops the moment
  you finish. Each stretch is now heard with half a second of quiet either side.
And when a word still has to be typed back, Approve sends a "check" report saying whether the speech model heard it
- so a next fix goes to the right step.
Only ./deploy.sh is needed.
**How:** `captions.ts` (`captionedIndices` works on `phrasesOf`, majority after the headline; `captionWords`
keeps a word starting up to 0.6 s before a stretch when 50 ms of it is inside, never an "um" or a repeat),
`timedWords.ts` (`padWithQuiet`, `keepInWindow`) used by `campaign/transcribe.worker.ts` only (the plain cutter's
worker is unchanged), `captionFixes.ts` (`typedBack`) reported from `CampaignApp` on Approve (kind `check`, phase
`captions`). Tests for each.

## Batch 1: post one now and one later, one-tap music, Reaction video, and a retry for missed accounts
**What:**
- **New post, One by one:** with two or more videos there is now **One by one** next to Spread them / All now.
  Each video then gets its own **Now** or **At a time** - one can go now and the other at 6 PM.
- **Add music** in Posts is just the song (with a play button) and one button: **Add music & approve** on a post
  waiting for you, **Add music** on one already approved or scheduled - it stays approved, no second approval. A
  post on "Approve, post later" or waiting for a brand still waits for you or the brand. The level is always
  Normal; songs come from the Bank (the "from my phone" picker is gone).
- **"Choose the campaign myself" is gone.** Videos are always sorted into their campaign. Reaction videos have
  their own **Reaction video** button under the drop zone (only when a campaign makes reaction videos).
- **A video that missed an account** (Posted, but "Not posted to Jake") now says so in orange on its row, with
  **Post again to the missing ones**: only the accounts that failed get it, a few minutes later, with the same
  video and caption. A video that failed everywhere gets **Post again**.
- Two accounts with the same name ("Ilyan Hamdane" on YouTube and on Instagram) now keep a link each, and a
  failure names the platform: "Not posted to Ilyan Hamdane (Instagram)."
**Needs deploying: run ./deploy-server.sh** (the retry, the music approval and the account names are on the
server), then ./deploy.sh.
**How:** `NewPost.tsx` (`each`, per-video `when`/`at`, `timeOf`); `MusicAfter.tsx`, `musicAfterSend.ts`
(`carry.approve`) and `postiz/index.ts start` (a carried post with `approve` gets `approval: 'direct'`, never past
a brand); `CampaignApp.tsx` (mode `one` lists reaction campaigns only); `postiz/failed.ts` (+ test) and the new
`retry-accounts` action (`retryAccounts`: asks Postiz which of the post's Postiz posts are in error, posts again
to those accounts only, drops the failed ids so they don't count again); `PostsView.tsx` (+ test).

## Posting: made to Instagram's and TikTok's own spec, and quiet songs turned up
**What:** posted videos looked soft on Instagram and TikTok while the preview looked fine - the file sent is the
preview, unchanged, so the softening happened at the platforms. Instagram's API takes nothing wider than 1920 px or
over 25 Mbps and wants the file's index ("moov") at the front; 4K files at up to 45 Mbps, with the index at the
end, were outside all three, so they were shrunk and re-compressed hard on the way in. Now every video is made at
1080x1920 at its own frame rate, at most 20 Mbps (about 16 for 60 fps), with its index at the front - what both
platforms ask for, and they show 1080p anyway.
Batch songs: a quiet song used to be left quiet ("never turned up"), so some batch videos had music you could
barely hear and no error. Now every song is set to the same level - loud ones brought down, quiet ones up (24 dB at
most), its peaks under the limiter so it never clips.
**How:** `makeSize` (quality.ts) is 1080 on the shorter side and the bitrate capped at `MAX_BITRATE`; the 4K and
"second go in 1080p" paths are gone. `moovToFront` (media/fastStart.ts) moves the index to the front of every
finished file the way qt-faststart does - the media data is sliced, never copied into memory - and gives the file
back unchanged if anything looks wrong; mediabunny's own `fastStart: 'reserve'` was tried and fails an assertion on
B-frame video. Checked with ffmpeg on 1080p60 files with and without B-frames, sound and none, and one written by
mediabunny: every frame and sample identical, index first. `liftMusic` (montageRender.ts) uses the voice's Limiter.

## Music: every song in a big batch gets heard
**What:** in a long batch (90, then 120 videos) only a couple of songs were coming through. The batch picks songs
evenly - checked with the real picker over 90 and a stacked 120 - so the songs were being lost when each video was
made: every video decoded its *whole* song into memory (a three-minute track is about 70 MB as samples, copied
again on the way), and with 4K frames in memory too the phone could not always manage it. A song that failed went
out silent ("Made without the music"); on a talking video, with no word at all. Now only the part of the song the
video uses is decoded - about 20 seconds instead of three minutes - and any song that still fails is reported, with
its type and size, so it can be seen and fixed.
**How:** `prepareMusic` (sounds.ts) reads just the song's first seconds with mediabunny and has the browser
resample them; a song the phone can't read that way is decoded whole, as before. Used by talking, reaction, batch
and add-music videos. Checked in Chromium with a three-minute MP3 and WAV: 21 s decoded, 440 Hz kept through the
44.1 to 48 kHz resample.

## Colour: the file says what the video really is, so no app adds contrast
**What:** made videos should no longer look like a harsh-contrast filter went over them once posted. The first
colour report showed why: his take was ordinary limited-range BT.709 (what every phone records), but Safari's
encoder labels what it writes as sRGB, *full* range - and that label went into the MP4. Apps that trust the label
and apps that trust the video stream then show different black and white levels. Now the label is set from what the
H.264 stream itself says, so every player - TikTok, Instagram, Postiz, Photos - reads the same levels. Applies to
talking, reaction, batch and joined videos and the plain cutter. The colour report now also says what the stream
says and what was finally tagged.
**How:** `avcColour.ts` reads the SPS's video signal type (range, primaries, curve, matrix) from the encoder's avcC,
or from the first packet; `matchStreamColour` (colourCheck.ts) writes it onto the encoder metadata in
`onEncodedPacket`, the same object mediabunny then muxes into the `colr` box. A stream that says nothing gets
H.264's own default, limited BT.709. Checked against real x264 streams in both ranges.

## Colour check: each made video reports what happened to its colour
**What:** nothing he sees changes. Each talking video now sends one "check" report saying how the camera recorded
it (HDR or not, and its colour tags), what the decoder handed over, and how the encoder wrote it. Asked for because
posted videos looked like a harsh-contrast filter had gone over them; an iPhone films in HDR by default, and every
campaign video is drawn onto a canvas, where Safari turns HDR into ordinary colour - the likely culprit. The report
shows which step does it, so the fix goes in the right place. Never the video itself, only these tags.
**How:** `colourCheck.ts`, hooked into `render.ts` through the encoder's `onEncodedPacket`; sent once per video.

## Quality: a 4K 60 fps take comes out 4K 60 fps
**What:** videos keep their own resolution up to 4K, their own frame rate, and a bitrate close to what the phone's
camera records at - about 16 Mbps for 1080p60 and 45 Mbps for 4K60. Before, every video was brought down to 1080p
and encoded at about 6 Mbps (the reports showed "avc1.640028 … 6111000 bps"), which is where the softness came from.
Applies to talking videos, reactions, batch videos and joined recordings. 4K is four times the pixels, so making
takes longer and files are bigger. If the phone's encoder can't do 4K, or a first go fails, that video is made in
1080p - still at the higher bitrate - rather than not at all.
Only ./deploy.sh is needed.
Files: `quality.ts` (+ test), `overlay.ts` (`outputSize` cap), `framing916.ts`, `render.ts`, `reactionRender.ts`,
`montageRender.ts`, `joinRender.ts`, `pipeline.ts`, `CampaignApp.tsx`.

## A video with no campaign: edit it again, or give it one, and send it
**What:** a finished video that went nowhere - no campaign recognised in it (General), or its campaign posts nowhere
yet - now says so on its row in Videos, with **Edit again and pick its campaign** (back in the list with its cuts,
captions and headline; pick the campaign, approve, and it's made again with that campaign's look and sent) and **Or
send it as it is to [campaign]** (only campaigns that post somewhere; sent unchanged under that campaign's posting
rules - approve it in Posts). Its recording is now kept for 7 days instead of 2 hours (the newest 10 such videos), and
after the app restarts they're listed under **Made, not sent** with Edit again and Remove.
Only ./deploy.sh is needed.
Files: `store.ts` (`unsent`, `UNSENT_KEEP_MS`, `madeNotSent`, `markJobSent`), `CampaignApp.tsx`, `JobRow.tsx`
(+ `jobRowNowhere.test.tsx`).

## Batch: a new batch on top of the running one, to post more a day
**What:** while a campaign's batch is still running, a new batch for it no longer has to wait until the last one
ends. Under **Posting** on the Batch tab, pick **On top - from today** (the default) or **After {the day after the last
one}**. On top, "Videos a day" becomes **More a day**: running 3 a day and adding 2 makes 5 a day while both run,
from today (or tomorrow if today's times have gone). The line under it says so - "3 already on Wed Oct 14 + 2 = 5
that day". The new videos' times keep 20 minutes clear of the ones already scheduled (closer, never under 10, on a
crowded day), all inside 11 AM - 6 PM. Every video is still a different one, approved in Posts as before. To scale
up step by step, make another small batch on top when you're ready.
Only ./deploy.sh is needed.
Files: `batch.ts` (`stack`, `lastPerDay`), `posting.ts` (`stackTimesOn`, `takenTimes`, + test), `BatchView.tsx`
(+ test).

## Background music: heard, still under the voice
**What:** background music is louder. **Background** now sits about 12 dB under your voice while you talk (it was
about 19 - inaudible on a phone), **Quieter** about 17. Your voice is always in front. Applies to every talking video
with music: an angle's music, a bank song picked for a video, reaction videos and Add music in Posts.
**Why it was so quiet:** the music dipped 5 dB more "while you talk, back up in the pauses" - but the pauses are cut
out, so it was dipped the whole video, on top of sitting 14 LU under you. Now 9 LU under, dipping 3 dB.
Only ./deploy.sh is needed.
Files: `music.ts` (+ test).

## Headlines: centred on what is drawn, not what is measured
**What:** a headline is now centred - and its white box sized - on the letters as the phone actually draws them.
It used to be centred on the width the phone measured, and nearly every headline ends in emoji, which an iPhone can
draw at a different width than it measures; that left the words off to one side and the box longer on one side.
Each line is drawn once off-screen before the video is made and its visible edges found, so whatever the emoji do,
the words sit in the middle. Plain-text headlines move by a pixel or two at most. Batch hooks (Claude + X) too.
Only ./deploy.sh is needed.
Files: `overlay.ts` (`inkOf`, `inkColumns`, + test).

## Pop-up videos: a clip comes up when you say its words
**What:** a new **Videos** section in the Bank tab, between Pictures and Music. Add a clip (screen recording, demo,
anything), type the words that bring it up - "Claude Code" - and in every angle that uses the bank, saying those words
pops the clip up over you: muted, in a big box (65% of the width by default, at the clip's own shape, never more
than three quarters of the height), with rounded corners and the same spring as the pictures, playing to its end. A
new mention takes over from one still playing. On the caption check before a video is made, a **Pop-up videos**
group lists the clips that take says and when, with a tick to leave one out, a **Size** slider (40-90%) and
**Top / Middle / Bottom** - the frame above shows the clip's still in the box as it will sit. Each video keeps its
own setting. A clip the phone can't play mid-make is left out and the video is still made.
Only ./deploy.sh is needed.
Files: `videoBank.ts` (+ test), `VideoBankView.tsx`, `popVideo.ts` (+ test), `look.ts`, `moments.ts` (+ test),
`pipeline.ts`, `render.ts`, `CaptionReview.tsx` (+ `captionReviewPops.test.tsx`), `CampaignApp.tsx`, `jobs.ts`,
`store.ts`, `sort.ts`, `campaign.css`.
**Underneath:** each clip is read already shrunk to its box (mediabunny `CanvasSink`), one decoder at a time,
opened when it comes up and closed when it ends, so a 4K clip costs no more than a small one.

## Music bank: songs with names, heard before they are picked
**What:** the Pictures tab is now **Bank**, with a **Music** section. Add MP3s, M4As or videos - from a video only
its sound is kept. Tap a song's name to rename it ("random text" → "Sad piano") and ▶ to hear it. Every music picker
lists the bank by name with a ▶ for the one picked: a video's Music before it is made, Edit on a batch video, Add
music in Posts, an angle's Background music (whose name can now be changed too), and Batch → Music ("From the music
bank", as a copy). One track plays at a time.
Only ./deploy.sh is needed.
Files: `musicBank.ts` (+ test), `MusicBankView.tsx` (+ test), `TrackPlayer.tsx` (`PlayButton`), `JobRow.tsx`,
`BatchEdit.tsx`, `MusicAfter.tsx`, `MusicRow.tsx`, `BatchView.tsx`, `CampaignApp.tsx`, `TabBar.tsx`.

## Captions: the last word no longer goes missing
**What:** the letter model that times each word had failed on 13 videos in two weeks, and those fell back to rough
times that lost the last word of a phrase. Now it gets 2.5 minutes to load and a second go after any failure; on
rough times a word up to 0.5 s into a cut pause goes back into its phrase (the take's last words, up to 1 s); the
last words always fit inside the video; and a word the speech model gives no time is kept.
Only ./deploy.sh is needed.
Files: `captions.ts` (+ test), `plan.ts`, `timedWords.ts` (+ test), `transcribe.worker.ts`, `pipeline.ts`,
`CampaignApp.tsx`.

## Posting: in the middle of the day, not at night
**What:** posts go out between 11 AM and 6 PM. Your own times outside that are skipped (greyed in Posting); a
campaign whose times were all at night posts as many a day at random inside it; a saved window is cut to it. A video
for today that comes in late spreads to 6 PM, or three hours after it comes in when later, never past midnight. A
post held to another day goes between noon and 2 PM. A post not yet in Postiz holding a night slot is re-timed when
it is sent; Unschedule → Approve re-times one already there.
./deploy.sh (it deploys the server too).
Files: `window.ts`, `slots.ts`, `batch.ts`, `postiz/index.ts` (+ tests), `posting.ts`, `PostingEditor.tsx`,
`NewPost.tsx`, `BatchView.tsx`, `CampaignApp.tsx`.

## Posts: a blue ticking clock on scheduled posts
**What:** on the Posts screen, a post waiting in Postiz for its time now shows a blue clock whose hand ticks round,
instead of the grey dot, and its time is blue too - so what's scheduled reads at a glance. A folded batch whose
videos are all scheduled gets the clock as well. Posted, waiting-for-approval and failed posts keep their dots, and
a post whose time has just come (going out now) loses the clock. The hand stays still if the phone is set to reduce
motion.
Only ./deploy.sh is needed.
Files: `icons.tsx` (`ScheduledIcon`), `PostsView.tsx` (+ test), `campaign.css`, `index.css`.

## A third caption style: Phrase
**What:** the plainest captions, for brands that want nothing busy. In the caption check before a video is made, the
style choice now has **One word**, **Highlight** and **Phrase**. Phrase shows the whole phrase as you start saying it
and swaps to the next when you move on - white with a black outline exactly like the TikTok headline, all
lowercase, a little smaller than a headline, two lines at most. No lit word, no pop, no shadow. Phrases break where
you stop or pause, up to seven words. Your pick is remembered for the next videos, as before; the caption position
and size settings work the same.
Only ./deploy.sh is needed.
Files: `captions.ts` (+ test), `render.ts`, `reactionRender.ts`, `CaptionReview.tsx`.

## Batch: the "Claude + X = $ a day" hook
**What:** a second kind of hook for batch videos. On the Batch tab, under **Hook**, pick **Claude + X** instead of
Headlines. Pick a **left logo** (e.g. Claude) and a **right logo** (e.g. OpenArt) once, and the range of the amount
(default $500 to $1,000). Every video in the batch then shows, over the reaction:

    [left logo]   +   [right logo]

          $650 a day

- the same two logos on every video, and its own amount, in steps of $50, with the ending varied ("a day", "/day",
  "per day", "daily");
- no other headline;
- a slow, strong push into your face for the whole reaction - a fifth closer by the cut - then the product clip,
  music and scheduling as before.
A small preview under the settings shows exactly how it sits on the video. The left logo is remembered for other
campaigns' batches, so you set Claude once. The caption Claude writes is told what the hook says ("Claude + OpenArt =
$650 a day").
**How:** `batch.ts` (`formulaLine`, `formulaText`, `hookOf`), `formulaOverlay.ts` (layout, drawing, the push),
`montageRender.ts` draws it on the reaction; the logos are kept in the batch bank like the clips.
**Checked:** unit tests for the amounts, layout and push; frames drawn in Chromium with the render's own functions.
Not an encoded video - this test browser can't write H.264 - so check the first batch on the phone.
Only ./deploy.sh is needed.
Files: `batch.ts`, `formulaOverlay.ts` (+ test), `FormulaPreview.tsx`, `BatchView.tsx` (+ test), `montageRender.ts`,
`pipeline.ts`, `store.ts`, `CampaignApp.tsx`, `campaign.css`.

## Fix: the server half of a deploy failing without anyone noticing
**What was wrong:** every server change since Oct 6 - Stop, random times everywhere, Approve post later, Add missing
hashtags - never reached the server. The posting function was still the Oct 6 version, because ./deploy-server.sh
kept failing at the Supabase login after ./deploy.sh had already put the new app live. So the new buttons showed up
and then said "run ./deploy-server.sh".
**Now:** ./deploy.sh does both. When the server code changed it runs ./deploy-server.sh itself, which asks for a
Supabase token (supabase.com/dashboard/account/tokens) instead of using the Mac's keychain, and offers to keep it in
~/.supabase-token so it never asks again. If the server part fails, it ends in red with "THE SERVER WAS NOT UPDATED"
instead of "Done". A bad or expired kept token says to delete ~/.supabase-token and try again.
Files: `deploy.sh`, `deploy-server.sh`.

## Redo captions now adds the missing hashtags by default
**What:** "Redo captions" rewrote every caption with Claude. Now the main choice keeps every caption word for word and
only adds the campaign's hashtags it is missing - for a whole batch or campaign at once, never one post at a time.
- **A batch:** on Posts, each batch row has **Add missing hashtags** (one confirm, every post in it). "Rewrite
  captions" is still there as a small second link.
- **A campaign:** in its Posting, "Add the hashtags to posts already made" (ticks itself when you change the
  hashtags; tick it yourself if you changed them earlier), then Save posting. When the rules text changed too, a
  second tick lets Claude rewrite them instead.
Scheduled posts keep their times: a post whose caption changes is taken out of Postiz and put back at the same
time; one that already has every hashtag isn't touched at all. Ones going out in the next 15 minutes are left as they
are. Pasted tracking captions never get hashtags, as before.
**Needs:** ./deploy.sh and ./deploy-server.sh.
Files: `postiz/index.ts`, `postiz/recaption.ts` (+ test), `posting.ts`, `PostsView.tsx` (+ test),
`PostingEditor.tsx` (+ test), `CampaignApp.tsx`.

## Redo captions after changing a campaign's caption rules
**What:** captions already written - waiting, held for later, or scheduled in Postiz - can be written again with the
campaign's rules and hashtags as they are now. Two ways:
- **A whole campaign:** Campaigns, the campaign, Posting. Under the caption rules there is now "Redo the captions
  already made" with how many posts it reaches. It ticks itself when you change the rules or hashtags; tick it
  yourself if you changed them earlier (like the hashtag you just added), then Save posting.
- **One batch:** on the Posts screen each batch row has **Redo captions**.
Scheduled posts stay at their times: each is taken out of Postiz only after its new caption is written, then goes
back at the same time. Ones going out in the next 15 minutes keep their old caption. Pasted (tracking) captions and
captions you wrote for a New post are kept word for word - only the hashtags are added. Posts show "Rewriting the
caption…" while it happens; 100 posts take several minutes. If a caption can't be written (no Anthropic key, Claude
down) the post keeps its old one and says so.
**Needs:** ./deploy.sh and ./deploy-server.sh. No database change.
Files: `postiz/recaption.ts` (+ test), `postiz/index.ts` (`recaption`, `rewriteMarked`), `posting.ts`,
`PostingEditor.tsx` (+ test), `PostsView.tsx` (+ test), `CampaignApp.tsx`.

## Approve, post later
**What:** next to Approve on each post waiting for you there is now **Approve, post later**. It approves the caption
but sends nothing to Postiz: the post moves to a new **Ready to post** list, where Save video works as long as you
like. Tap **Post** there when you want it to go - at its time if that is still ahead, otherwise at the next free time
(or straight away). Ready posts don't count as "posts to approve" in notifications or in Approve all, and the caption
can still be changed. Taking a scheduled post back puts it under To approve again, not Ready.
**Needs:** a new column on the server (`ready_at`, migration `20261010120000_cutter_posts_ready.sql`) and both
deploys - ./deploy.sh and ./deploy-server.sh. Until the server is updated the button says so instead of failing
silently.
Files: `postiz/index.ts` (`ready` action), `posting.ts`, `PostsView.tsx` (+ test), migration.

## Posts: filter by campaign, batches folded into one row
**What:** the Posts screen got long - a batch of 25 a day for a week filled the whole page. Now:
- **Filter:** chips at the top - "All 180", "Polsia 150", "Inflow 30" - show one campaign at a time. The phone
  remembers the last one picked. It applies to every list on the screen (To approve, On the way, Failed, Scheduled,
  Posted), and "Approve all" then approves that campaign's only.
- **Batches folded:** each batch is one row - "Polsia · 25 videos", its days and when the next one goes. Tap it to
  open the posts inside, tap again to fold it. Single videos still show one by one.
- **Posted** shows the latest 10, with "Show all" for the rest. Scheduled and Posted show their count in the title.
Only ./deploy.sh is needed.
Files: `PostsView.tsx` (+ `postsView.test.tsx`), `postsList.ts` (+ test), `campaign.css`.

## Fix: Batch made twice on a double tap, and only 1 or 3 videos a day (now up to 25)
**What was wrong:** tapping "Make 6 videos" twice quickly could make the whole batch twice - the button stayed live,
and a second tap before the screen caught up planned the same days again. And "Videos a day" only offered as many as
the campaign had times: 1 for a campaign with one time of its own, 1-3 for a random one.
**Now:** the first tap locks the button at once; it reads "Making…", then "Making 3 of 6…" while that campaign's
batch is made, and can't be tapped again until it's done. Afterwards it names the days the next batch would cover
("Make 6 more videos - Wed Oct 14 to Fri Oct 16"), so a second batch is clearly a different one.
"Videos a day" is now a − / + counter from 1 to 25. A random campaign draws that many random times from its window,
different each day. A campaign on its own times keeps them and, when you want more videos than it has times, adds
random ones from the window, clear of yours. Times are half an hour apart when the window has room and closer when
you want more (25 in 10 AM - 10 PM is about 29 minutes apart), never under 10 minutes; a window too short for the
count says how many it fits, in amber. The hint under it lists today's times. Posts-a-day limits you set in Settings
still apply on top: posts over a limit are held for the next day with room.
Only ./deploy.sh is needed - the server already posts a batch video at the time it was made for.
Files: `BatchView.tsx` (+ `batchView.test.tsx`), `posting.ts` (`batchTimesOn`, + test).

## Random posting times in every campaign, and late videos at random until midnight
**What:** every campaign now posts at a different random time each day. A campaign with no times of its own used to
post each video the moment it was ready; now it posts 3 a day at random between 10 AM and 10 PM. Each campaign keeps
its own window: change it in Campaigns, the campaign, Posting (it opens on Random times). Campaigns where you set your
own times keep them until you switch them: Settings, Posting, "Random times for every campaign", Switch all. That
gives each of them random times, keeping any window it already had, and leaves its accounts alone.
A video that comes in late - say 10 PM, after the day's times have gone - now gets a random time between 20 minutes
after it arrived and midnight, at least 15 minutes from any other, instead of the evenly spaced spread. The same goes
for extra videos beyond the day's times. Batch videos are made ahead and keep taking each day's random times from
the window, as before.
**How:** `window.ts` has `DEFAULT_WINDOW` (10:00-22:00, 3 a day); the server's `timesFor` and the phone's
`placeTimesOn` fall back to it, so the phone shows the same times the server will use. `spreadDay` (`slots.ts`) now
draws each late video's time from its post id, so a video keeps its time when another late one arrives, and videos
already in Postiz never move.
**Needs deploying:** both - `./deploy.sh` for the phone and `./deploy-server.sh` for the late-video times and the
default window on the server.
Files: `window.ts`, `slots.ts` (+ tests), `index.ts`, `posting.ts` (+ test), `PostingEditor.tsx` (+ test),
`SettingsView.tsx`, `CampaignApp.tsx`, `NewPost.tsx`, `BatchView.tsx`.

## Fix: the tab bar drifting with the scroll (third try - the cause, not the symptom)
**What:** the bar - Videos, Batch, Campaigns, Pictures, Settings - still followed the scroll instead of staying on
the bottom of the phone. The earlier fixes worked around an iOS 26 bug (WebKit 301108) that only happens in a Home
Screen app whose status bar is see-through; this one removes what sets it off: the status bar (time, battery) is
now plain black instead of see-through. On this black app it looks the same. The page also no longer rubber-bands
past its top and bottom, which made the bar look like it was moving.
**If it still drifts after ./deploy.sh:** iOS can keep the old status bar setting from when the app was added to
the Home Screen - delete the Cutter icon and add it again from Safari (Share, Add to Home Screen). Nothing on the
phone is lost: videos and settings are kept by the site, not the icon.
**Checked:** builds; not on an iPhone - only your phone can show it.
Files: `campaign.html`, `index.html`, `campaign.css`.

## Fix: Stop N posts did nothing
**What was wrong:** pressing the red Stop button spun for a moment and then nothing changed - the posts stayed
scheduled. The posting function on the server is still the one from Oct 6 (./deploy-server.sh hasn't run since),
which doesn't know the new "stop these posts" request, so it refused it - and the picker showed that refusal under
the long list of posts, out of sight.
**Now:** with a server that hasn't been updated, the phone stops the posts itself, one by one, using the same Reject
the button on each post has always used (it takes a scheduled post out of Postiz). Three at a time, soonest first, so
the next one due is stopped first; the button counts "Stopping 23 of 73…". Any that won't stop stay ticked with the
reason, and pressing Stop again retries just those. Problems now show at the top of the picker. Once
./deploy-server.sh has run, the faster all-at-once stop is used instead, automatically. The campaign screen's "Stop
all posts" button falls back the same way.
Only ./deploy.sh is needed for this.
Files: `posting.ts` (`stopPostsNow`, + test), `StopPicker.tsx` (+ test), `CampaignApp.tsx`.

## New: select posts on the Posts screen and stop them in one go
**What:** the Posts screen has a **Select** button. It lists every post that can still be stopped (to approve, on
the way, scheduled), with a chip per campaign - "Inflow 64", "Vertus 12" - that ticks all of that campaign's posts in
one tap, and **All**. Tick or untick any post by hand, then **Stop N posts**. They stop at once and none of them goes
out; the ones in Postiz are taken out of it in the background over the next few minutes. Posts already out, failed,
or past their time aren't in the list.
**How it works:** a `stop-posts { ids }` action on the posting function - the same stop as "Stop all [campaign]
posts", for the ticked posts (your own only, up to 500 at a time).
**Needs deploying: run ./deploy-server.sh** (and ./deploy.sh for the screen).
Files: `StopPicker.tsx` (+ test), `PostsView.tsx`, `posting.ts`, `postiz/index.ts`, `index.css`, `campaign.css`.

## New: Highlight captions - the phrase at once, the word being said in yellow
**What:** a second caption style. Instead of one word at a time, the phrase (up to 4 words, on one or two lines)
is on screen together, white with the usual dark edge, and the word being said turns yellow with a small pop. It
keeps every timing of the one-word captions: the same lead, hold, words taken out and no captions under the hook.
**How to use it:** on a video's captions screen, under Top/Middle/Usual/Bottom: **One word / Highlight**. The
preview changes at once. Whichever you pick last is where new videos start; size and position work the same for
both. Edit again keeps the video's style.
**How it works:** `drawPhrase` in `captions.ts` lays the phrase out once (so nothing moves while it's up) and lights
the word `captionAt` picks; phrases are the review list's phrases, capped at 4 words to fit.
Files: `captions.ts` (+ test), `render.ts`, `reactionRender.ts`, `pipeline.ts`, `jobs.ts`, `store.ts`,
`CaptionReview.tsx`, `CampaignApp.tsx`. App only: `./deploy.sh`.

## New: stop all of one campaign's posts
**What:** for a finished campaign, one button stops every post of it that hasn't gone out yet - waiting for approval,
approved, or scheduled in Postiz. Scheduled ones are taken out of Postiz; all of them are marked rejected, the same
as tapping Reject on each. Only that campaign's posts: every other campaign keeps its schedule, and posts whose time
has already come are left alone.
**How to use it:** Campaigns, open the campaign, under Posting: **Stop all [campaign] posts**. It asks first, then
says how many it stopped. Deleting a campaign now also asks "Also stop every [campaign] post that hasn't gone out
yet?" - before, deleting it left its scheduled posts going out. Archiving in the planner does not stop anything;
do this first.
**How it works:** a `stop-campaign` action on the posting function, for your own posting profile only. It stops
every post in one go however many there are - a hundred is as quick as one - so nothing can go out after you press
it. Posts already in Postiz are then taken out of it in the background, 20 at a time; each shows "Stopped - taking
it out of Postiz" on the Posts screen until it's gone, and if the run is cut off the 5-minute scheduler finishes the
rest. One Postiz won't let go of says so after a few tries: "Couldn't take it out of Postiz - delete it there".
**Needs deploying: run ./deploy-server.sh** (and ./deploy.sh for the button).
Files: `supabase/functions/postiz/index.ts`, `posting.ts`, `CampaignsView.tsx`, `CampaignApp.tsx`.

## New: random posting times, so a campaign never posts the moment a video is ready
**What:** a campaign's Posting now has two choices under Your times: **My own times** (as before) or **Random times**
- "between 10 AM and 10 PM, 2 a day" (change all three). Each day gets its own random times inside that window, at
least 30 minutes apart, different every day and different from your other campaigns. A video takes the next free
one, exactly like your own times; more videos than that on a day spread out to midnight, as extra videos always
have. A campaign with neither now says so in red - on its Posting screen and on its row in Campaigns: "No times -
each video posts the moment it's ready".
**How to use it:** Campaigns, open the campaign, Posting, Postiz, Your times, tap Random times, set the window and
how many a day, Save posting. The Batch tab and New post use the same random times (Batch shows today's).
**How it works:** `supabase/functions/postiz/window.ts` turns a window into a day's times from the campaign and the
date, so the same day always gives the same times and a time is still a slot that holds one video. The server and
the phone both use that one file, so what the Batch tab shows is what the server does. Your own times always win
over a window; only one is saved.
**Needs deploying: run ./deploy-server.sh** - until then the server ignores the window and those campaigns still
post at once, so deploy before relying on it.
Files: `postiz/window.ts` (+ test), `postiz/slots.ts`, `postiz/batch.ts`, `postiz/index.ts`, `PostingEditor.tsx`
(+ test), `posting.ts`, `batch.ts`, `BatchView.tsx`, `NewPost.tsx`, `CampaignApp.tsx`, `CampaignsView.tsx`.

## New: the planner can see which Postiz channels a finished campaign still holds
**What:** when you archive a campaign in the planner, it now lists that campaign's Postiz accounts - connected or
disabled - with "Channels in use: N of 30", which other campaign still posts to the same account (keep those), and
how many posts are still due on them. You disable them in Postiz yourself (Postiz has no way for an app to switch a
channel off - the only call that touches one deletes it for good, with its scheduled posts), then press Check
again. Restoring a campaign shows the reverse, so you can switch them back on.
**How it works:** a new `channels` action on the posting function. Only the planner's own server function can call
it, proving itself with the Supabase project's service key (which already seals every Postiz key here, so it opens
nothing new); it reads Postiz's account list with your saved key and changes nothing there. No key leaves the server.
**Needs deploying: run ./deploy-server.sh** (the planner shows nothing for it until this is out).
Files: `supabase/functions/postiz/channels.ts` (+ test), `supabase/functions/postiz/index.ts`.

## Fix: adding a picture on the cuts screen, a way to the captions, and room to fix captions
**Cuts screen - adding a picture:** "+ Picture" opened its picker below the bottom edge of the phone, so pressing
it looked like nothing happened. The picker now opens right under the video, with "From my phone" and the
picture bank in view. If the playhead is on a part that is cut out, it says so straight away (move it onto a
kept part), instead of after you have chosen a photo and then dropping it.
**Cuts screen - to the captions:** a **Captions** button next to Done. It keeps your cut changes and pictures, the
same as Done, and opens that video's captions (asking first whether the hook gets captions, as the list does).
Opened from the captions screen, it goes back to them. The running time moved down next to the zoom buttons to
make room.
**Captions screen:** only the video stays held at the top now. The headline box, Top/Middle/Usual/Bottom,
Small/Normal/Large/Huge and "+ Add" moved under the list of captions, just above Approve: held at the top with the
video they filled the phone's screen, and the captions scrolled by behind them out of sight. On a phone-sized
screen 4-5 captions now show at once (none did before); changing position or size from down there still shows
on the video at the top.
**Checked:** in a phone-sized Chromium - the picker and the "move the playhead" note opening fully in view; a bank
picture and a phone photo added (on the video, on the timeline, in the list); Captions handing back the cuts and
both pictures; the captions screen with 4-5 phrases in view and the look controls working from the bottom.
Files: `CutsEditor.tsx`, `CaptionReview.tsx`, `CampaignApp.tsx`, `campaign.css`.

## Fix: black strip under the tab bar (undoes the change below)
**What:** the "frame the size of the screen" from the last update left a dead black strip at the bottom of the
iPhone, with the bar - Videos, Batch, Campaigns, Pictures, Settings - a block up from where it belongs. It is back
to how it was: fixed to the bottom of the screen, the page scrolling under it.
**Why the bar misbehaved at all:** on iOS 26 an app added to the Home Screen is told the screen is a status bar's
height shorter than it is (a WebKit bug, 301108, set off by this app's see-through status bar). A frame sized to
"the screen" stops that much short - the black strip. A short screen (Batch, Pictures, a short Videos list) ends
that much short too, and the bar sits on its end instead of the bottom of the phone and moves as you scroll - the
"stays with me, doesn't stay all the way down" from before. The one size iOS gets right there is the "large
viewport" (`lvh`), so in the Home Screen app the page is now always at least that tall, and the bar should sit
on the bottom on every screen. In a Safari tab nothing changes.
**Checked:** in a phone-sized Chromium the bar is at the very bottom on short and long screens and while
scrolled, and the new rule is read by the browser. Not on an iPhone: whether the bar now sits on the bottom of a
short screen in the Home Screen app needs your phone.
Files: `CampaignApp.tsx`, `TabBar.tsx`, `campaign.css`.

## Deploying no longer needs Supabase (no more keychain box)
**What:** `./deploy.sh` now only ships the app: it gets the latest code and puts it on Netlify. It no longer
runs the Supabase command, which is what asked for a "keychain" password on the Mac - and since the script
stopped there, nothing after it was going live either.
**Use it:** `cd /Users/ziadissa/Projects/silence-cutter && git pull && ./deploy.sh`, then reload the cutter on
the phone. Netlify may ask you to log in once in the browser.
**The server:** the two server functions (posting, and the shared login) rarely change. When an update does
change them, `./deploy.sh` ends with "Run: ./deploy-server.sh". That one still uses Supabase: if the Mac asks
for a keychain password, it is your Mac's own login password - type it and press "Always Allow". The planner
bridge setting it used to set every time is already set and stays set.
**Now:** nothing on the server has changed since the last deploy (Oct 6), so `./deploy.sh` is all that is
needed today.
Files: `deploy.sh`, `deploy-server.sh` (new), `.gitignore`, `AGENTS.md`.

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
found with a line measured on each take, because quieter words sit at -35 to -39 dB. In a quiet take a
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

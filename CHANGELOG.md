# Cutter patch notes

Newest first. Every change says what it does, how to use it, and how it works
underneath. Kept up to date with each commit.

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

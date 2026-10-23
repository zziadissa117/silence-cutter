# Plan: UGC from start to finish with as little of Ziad as possible, and giving the tools to a few students

Written 2026-10-23. A plan only - nothing here is built. Part B needs his OK before anything is made: creating
logins is against the hard rules (AGENTS.md rule 1) until he has read this.

Where things stand (from the code of both apps and the live database):
- Campaigns are found by hand (the planner's daily to-do says "Apply for campaigns on every app: SideShift, Gimi,
  Reddit"). No Reddit bot is in either repo - ask where it lives and what it writes out.
- A campaign enters the planner by pasting the brief and contract (Claude parses them, he ticks what is right), then
  he types the accounts, rates, posts a week; then he makes the same campaign again in the Cutter by hand (name, brand
  words, angles, headline looks, pictures, accounts, posting times).
- Filming: the planner's Console lists what to say; the Cutter later guesses which campaign a recording is for from
  the words heard (the "unsure" videos).
- Cutting, captions, posting, the planner's ticks and views: automatic already (the cutter bridge).
- Last 30 days: 524 posts went out across 33 Cutter campaigns; 1,767 batch videos; 84 by hand.

## A. The whole line, hand-off by hand-off

Each step says what he does today, what the program could do instead, and what it needs.

### A1. Finding campaigns: the Reddit bot -> a "Found" list in the planner
- Today: the bot finds posts; he reads them and applies by hand on each site.
- Plan: the bot writes each find into a planner table `campaign_leads` (link, where it was found, the post's text,
  what it says about pay, when). One planner Edge Function `lead` takes them, gated by a secret the bot holds (like
  the Cutter's `tick`). The NOW screen gets a line "3 new campaigns found" with, per lead: the pay it mentions, a
  one-line summary written by Claude, and two buttons - Apply (opens the application link with his standard answers
  ready to paste: handles, rates, three sample links; the planner keeps those once) and Not for me (the bot stops
  showing that brand). Applied leads wait in "Applied"; when the brand answers he pastes the brief and the lead
  becomes the campaign (A2) - the lead's link and pay are already filled in.
- Needs: where the bot runs and what it outputs today (it may already write JSON somewhere). About a day of work
  once that is known; the bot itself may need a few lines to post to the function.

### A2. Brief -> campaign with nothing typed
- Today: parse, tick, then type rate, posts a week, min views, and the accounts (handle, email, password per
  platform) - again for every campaign.
- Plan: the parser already finds rate, quota and min views; make the review screen take them as ticked unless the
  quote is missing. Accounts: one account book per person (his handles, emails, passwords, which platform), filled
  once; a campaign picks accounts from it (tick which post for it) instead of retyping. The Cutter already knows his
  Postiz channels by handle - the same list, so a campaign's accounts are one tap: "post from @traderzi2 and
  @ziad.issa".
- Needs: a `accounts` table in the planner (per user, RLS as the others) - SQL shown first. Half a day.

### A3. Planner campaign -> Cutter campaign in one tap (the big one)
- Today: he makes every campaign twice.
- Plan: when a planner campaign is saved, a planner Edge Function `to-cutter` (owner-gated like `planner-postiz`,
  writing `cutter_items` with the service role - the Cutter's sync reads them like any change from a phone) makes
  the Cutter campaign: name and brand words from the brief (product name, company, the words the parser found);
  one angle per generated hook with the hook as the headline, the look he used last, and a Formats script from the
  hook's body beats; accounts from A2 matched to Postiz channels by handle; posting times = the quota spread over
  the window he uses most (the Cutter already has every post's time). The link `campaigns.cutter_campaign_id` is set
  at once, so posts tick back without the "Link to the Cutter" step. Edits in the planner (a new hook, a changed rate)
  flow the same way; the Cutter stays the place for looks, pictures, sounds and music.
- Needs: the function (a day), a `cutter_items` writer that respects the Cutter's own shapes (`look.ts` Campaign,
  Angle) with tests against the Cutter's `cloud.ts` reader, and his OK on which fields the planner owns from then on.

### A4. Filming -> the Cutter knows what each recording is
- Today: the Cutter listens and guesses the campaign from the words; some are "unsure"; he answers.
- Plan: the Console already knows the campaign and the hook he is filming, and when ("Filmed one"). It writes a
  `filming_sessions` row (campaign, hook, started, each "filmed one" moment). The Cutter, given a recording's own
  time (the file's date - phones keep it), matches it to the session and sets campaign, angle and headline with no
  guess and no question; the words heard only confirm it. Unsure videos go away for anything filmed through the
  Console. The Console's "Say this" list can also become the hook's Formats script lines, so one filming session
  fills a format.
- Needs: the table (SQL), a few lines in the Console, a reader in the Cutter's `sort.ts`. A day.

### A5. Cutting and approving: the two taps that are left
- Today, per video: Captions (one screen, everything prefilled) and Approve; batch videos need Approve all.
- Plan: a per-campaign switch "post without asking" for campaigns the brand approves nothing on (`approval: direct`):
  a video whose captions Claude's second look found nothing wrong with, with no "unsure", no missing picture and no
  "didn't hear", goes straight to Scheduled. Captions stay one tap away (Edit again) for two hours as now. The
  Videos screen then only shows what needs him.
- Needs: nothing new in the database; a day in `CampaignApp` + a report of what was auto-approved for a week before
  trusting it. This changes how posting behaves for him - his call.

### A6. Posted -> money, with no ticking
- Today: posts tick themselves (the bridge); earnings count; he still watches min views and bonus tiers, and marks
  payouts paid.
- Plan: the bridge already carries views; when a video passes `min_views` on any account the planner writes the
  bonus claim itself (the tiers are parsed from the contract) and shows "bonus due: $X, claim at <link>". Payout
  dates from the contract -> a reminder the day before with the invoice amount (the invoice skill can write it).
  When a contract's end date passes: "end this campaign?" -> the Cutter's End campaign (frees the Postiz channels).
- Needs: half a day; no new tables (bonus_claims and campaign_payouts exist, unused).

### A7. The day's plan from the clock, both apps in one line
- The NOW screen already sorts his day; feed it the Cutter's state through the bridge (videos to approve, failed,
  batch days made ahead) so "what now" is one place: film, approve, apply.

Order to build: A3 first (saves the most time every week), then A4, A1, A5, A2, A6, A7. All of it is per-user data
with the planner's RLS and the Cutter's space; nothing opens to anyone else.

## B. The tools for a few students, privately

### B1. What exists
- The Cutter: one shared login (name + password) in `cutter_spaces`; a space holds everything (campaigns, bank,
  posts, the posting profile and its sealed keys). Logins cannot be created (the function ignores `create`). Every
  table is server-only. The admin password opens the oldest space only.
- The planner: Supabase Auth by magic link, data per user with RLS - but anyone with an email can get in today
  (Confirm Email is off): that is open sign-up in all but name. If students get the planner too, close it first
  (B3's allow-list applies there as well).

### B2. Invite only - nothing to find or join
- No sign-up page, ever. The sign-in screen stays as it is; an unknown name still answers "Wrong login or password".
- Only Ziad, signed in as admin, makes a student: Settings (admin only) > Students > "Invite" > the student's name.
  The server makes a new space (status `invited`) and a one-time code (random, 128 bits, stored hashed, dead after 48
  hours or one use). He sends the code or the link (`cutter.app/?invite=...`) himself, by WhatsApp.
- The student opens the link, sets a password, is signed in. The code is burnt. Nothing else creates a space.
- This is "login creation" by another name: it stays out of the code until he says yes to this plan.

### B3. Can't be passed on
- Each phone, on its first sign-in, makes a key pair in the browser (WebCrypto, the private key cannot be exported;
  kept in the app's own storage) and registers the public key. Every call to the server is signed by that device; the
  login token is bound to it. A copied token from another phone is refused.
- A student gets 2 devices (phone + a second phone or iPad). A third sign-in says so and offers to drop the oldest;
  the dropped device is signed out at once (its next call is refused, the app shows the sign-in screen).
- Sign-ins from a new device, or two devices more than ~500 km apart within a day (the server sees the IP; rough
  but enough), send Ziad a push and an email: "Kari signed in on a new iPhone (Toronto)". More than 2 devices in a
  week pauses the student automatically until he looks.
- Sessions end after 30 days unused; a password change signs every device out. Invite codes are single-use.
- Honest limit: nothing stops a student handing their unlocked phone to a friend in the same room. The device limit,
  the alerts and the pause make sharing expensive and visible; that is what software can do.

### B4. Ziad stays in control
- Settings > Students (admin only): each student with last seen, devices (name, model, first/last seen), videos made
  and posts sent this week, and two buttons: Pause (every call refused with "Paused - ask Ziad") and Remove (signed
  out everywhere now; the space's data deleted after 30 days; Postiz posts untouched - they are the student's own
  account).
- A weekly email: who used it, how much, any alerts.

### B5. Their data is separate; his keys never travel
- Every table is already per space (`cutter_items.space_id`, profiles belong to a space, posts to a profile).
  A student's token opens their space only - the same check that keeps his friend's data apart today.
- Postiz: each student connects their own Postiz account (their key, their channels) in their own posting profile;
  the keys are sealed per profile as now. His Postiz key is never readable by another space - it is not even in the
  same row.
- Anthropic (captions, the caption writer): either the student pastes their own key (a $5 credit lasts months), or
  Ziad lends his with a per-student monthly cap counted in `cutter_config` (the Cutter already counts cents per
  recheck); past the cap, captions are still made, only the written post caption falls back to the transcript.
  Default: their own key; the loan is a switch per student.
- Buffer, the engine, the Cutter server: each student sets their own if they want them; the Railway server is one
  per posting profile by design already.
- The shared music bank is shared by everyone in a space: students get their own bank in their own space.

### B6. Easy for them
- First run after the invite, four screens, each one thing: 1) choose a password; 2) connect Postiz (paste the key -
  with a 20-second video of where to find it - then tick the accounts to post from); 3) the first campaign: brand
  name and the words to listen for, pick a headline look from three, done (everything else has a default); 4) add
  one video and watch it go through to Posts. A "try it" sample campaign with a 10-second clip is there before they
  have any of their own.
- Tips on by default for a new space; off for him. The words are the plain ones already used; the settings that only
  make sense for him (Server, Engine, Buffer) are hidden until a student asks for them.
- A one-page "how it works" in the app (the Videos screen's empty state), not a manual.

### B7. What each student costs, and what they need
Per active student (25 posts a day, 30 MB a video):
- Supabase: rows are tiny; the `postiz-outbox` copies are ~1-3 GB per student while Postiz takes them (his bucket
  holds 5.7 GB now). The project is on the free tier today; with students it needs Pro ($25/month, 100 GB) - once,
  not per student. ~$0-1/student/month on top.
- Edge Function calls: ~5,000 a day per student, well inside Pro's 2 million a month.
- Netlify: the app is small; free tier covers it.
- Anthropic, if he lends his key: a post caption ~0.5 cent, a captions recheck ~2 cents -> about $4-8 per student a
  month at 25 posts a day. $0 if they use their own key.
- Speech and letter models: run on their phone, free.
- Postiz: theirs. Postiz cloud is from about $29/month (5 channels) to $49-99 for more; self-hosted Postiz on a
  $5-10/month box is free of licence. Not his cost unless he hosts one Postiz for everyone (then one Team plan or
  one self-hosted box, with one workspace per student - possible, but his key would then sit in one place for all).
- The Cutter server (Railway), if they want batches made day and night: $5-15/month each, their own Railway account.
- What they need on their side: an iPhone on iOS 17 or newer (the video maker needs it), Safari, the app added to the
  Home Screen, a Postiz account with their social accounts connected, optionally an Anthropic key and a Railway
  account. No computer.
So: ~$25/month fixed for Pro once there are students, and $0-8 per student a month depending on whose Anthropic key.

### B8. What has to change in the code and the database (for his OK)
- `cutter_spaces`: `status` (active / invited / paused / removed), `invite_hash`, `invite_until`, `owner_note`;
  a `cutter_devices` table (space_id, device_id, public key, name, first_seen, last_seen, last_ip_country);
  `cutter_alerts` (or rows in `cutter_errors` kind `admin`). RLS on, no policies, service role only, like the rest.
- `cutter/index.ts`: actions `invite`, `accept-invite`, `students`, `pause`, `remove` (admin token only), device
  signing on every call (`whoami` learns the device), the device limit, the alerts. The one place that today ignores
  `create` keeps ignoring it: an invite is the only door, and it is opened by the admin.
- The app: the invite screen, the device key, Settings > Students, the first-run screens, the student defaults.
- The planner, if it is shared too: an allow-list of emails (the owner list exists for the cutter bridge) so a magic
  link is sent only to names he added.
- About two weeks of work in all; the invite/device part first, the first-run screens second.

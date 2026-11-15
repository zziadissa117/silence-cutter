# The Cutter - feature inventory

Every screen, tab, button, setting and automatic behaviour of the Cutter, with where it lives in the code, grouped
and ranked by how much it matters to a UGC creator (most important first). It is the map the guide
(`cutter-guide.pdf`) is written from.

- Paths are under `src/campaign/` unless they say otherwise (`server/`, `supabase/functions/`, `src/`).
- **Owner** = only the main login (and the admin backup) sees it. Everything else is the same for every login.
- **Tested** column (filled in Phase 3):
  - **Real** - tested for real here (real video in Chrome for Testing, or the real server logic).
  - **Browser** - opened and used in the browser in demo mode, no real video made.
  - **Code** - read in the code only (needs an iPhone, the camera, real posting or real keys).

## How the ranking was decided

His suggested order holds, with three moves the code argues for:

1. **Posting set-up (keys) and Your voice move up to "Getting started".** The app asks for both on day one: the
   Videos tab shows "Set up your voice - 45 seconds" until it is done, and Posts, Batch and the week tracker stay
   empty until posting is connected (Settings -> Posting -> Set up). They are not "settings" a creator tweaks later.
2. **The Bank (pictures, videos, music, sound effects) joins Campaigns.** Angles, batches and the edit screen all
   pick from it; it is set up with the campaigns, not on its own.
3. **New post (posting finished videos) joins Posting.** It is the Posts tab's "+ New post".

## Contents

1. Getting started - sign-in, the tabs, posting keys, your voice, recording
2. Simple cutting - adding videos, the cut, "um"s, captions, the caption check, the edit screen, Cut only
3. Campaigns - brand, angles (look, headline, pictures, sound, effects, clips), posting rules, captions per kind,
   accounts, Instagram location, the Bank
4. Posting - Posts tab, To approve, scheduling, missed posts, Buffer backup, Edit again, New post, limits
5. Batches - formats, drop-in, clip check, Cut/Raw, speed, steps, music, videos a day, Start, status, server
6. Formats tab, One video new songs
7. Analytics and What works
8. Trial reels (owner)
9. Motion graphics, Warm-ups
10. Settings - captions, cutting, framing, effects, server, engine, people, look
11. Things the app does by itself (all sections)
12. Found while mapping (checked in Phase 3)

---

## 1. Getting started

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Sign-in page | Login + password; nothing else of the app renders until signed in. Wrong name/password: "Wrong login or password." 5 wrong tries lock 30 min (server). | `LoginGate.tsx`, `SignIn.tsx`, `cloud.ts signIn`; server `supabase/functions/cutter/index.ts login` | |
| One-time sign-in link | A link the owner makes in Settings -> People opens "choose your password"; works once, 48 h. No sign-up anywhere else. | `AcceptInvite.tsx`, `cloud.ts acceptInvite`; server `cutter/invite.ts` | |
| Phones per login | A login made with a link works on at most 3 phones (Safari and the Home Screen app count apart); the owner is told about each new phone. | server `cutter/index.ts` (`MAX_DEVICES`), `People.tsx` | |
| Signed in stays signed in | The session is kept on the phone; offline use keeps working. Signed out by the server -> back to sign-in. | `cloud.ts currentSession/keepSession`, `LoginGate.tsx` | |
| Tab bar | Videos, Posts (count of posts to approve), Batch, Analytics (dot when a suggestion waits), More. | `TabBar.tsx` | |
| More menu | Campaigns, Formats, Motion graphics, Trial reels (owner / turned on), Warm-ups, Bank, Settings, Cut only. | `MoreView.tsx` | |
| Videos home top | Greeting + name, sync chip ("Shared" / "Syncing" / "Not synced" -> opens Settings). | `HomeTop.tsx`, `CampaignApp.tsx` ~3945 | |
| Today card | "N videos going out" with out / scheduled / to approve / failed pills; tap -> Posts. Only with posting set up. | `HomeTop.tsx` 53-87 | |
| "Set up your first campaign" | Shown with no campaign yet; until then videos go to General. | `CampaignApp.tsx` ~3973 | |
| Connect posting (keys) | Settings -> Posting -> Set up: Buffer or Postiz API key + Anthropic (Claude) key; keys are sealed on the server, never on the phone. | `PostingSetup.tsx`, `posting.ts connect`; server `postiz/index.ts connect/connectBuffer` | |
| Your voice (45 s, once) | Records the room, a read-out text, your "um"s and a breath; every video is cut for the voice it sounds like. Reminder on Videos until done; "another mic?" reminder when videos sound different. Several voices, Automatic or pinned. English or French text. | `VoiceSetup.tsx`, `voiceProfile.ts`; Videos reminder `CampaignApp.tsx` ~4015 | |
| Record a video | Full-screen camera: double tap flips, pinch zooms, light (screen / torch), Steady on/off, record in parts, ⌫ deletes the last part, ✓ joins them. Back-camera takes are steadied after Done when it helps. Opens the caption check by itself once heard. | `Recorder.tsx`, `stabilize.ts`; `CampaignApp.tsx` 4924-4936, 4682 | |
| Add videos | "Add videos - sorted into campaigns": the phone's picker, several at once; dropped files on a computer. iPhone tip: picker Options -> Format -> Current (no slow convert). | `VideoPicker.tsx`, `pickFormat.ts`, `pickWatch.ts`, `words.ts PICKER_CURRENT` | |
| Week tracker | "This week": a line per campaign, a box per day - Scheduled (yellow), Batch makes it (pale yellow), Posted (blue), To approve (purple), Didn't go out (red). ‹ › for other weeks; tap a box for the day's detail. | `WeekTracker.tsx`, `trackerLines.ts`; server `postiz/tracker.ts` | |
| Your campaigns strip | Brand badges; tap -> Campaigns. | `HomeTop.tsx` 122-142 | |
| New version | A new version waits until nothing would be lost, then the app reloads into it ("Updating the Cutter to its new version…"). | `src/UpdateBanner.tsx`, `CampaignApp.tsx` ~5191 | |
| Crash screen | "Something went wrong on this page… Reload to carry on" with Details; the crash is reported. | `src/CrashGuard.tsx`, `src/report.ts` | |

## 2. Simple cutting (one talking video)

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Sorting into campaigns | Each added video is listened to and put in its campaign + angle by what is said; "Needs you · Heard X, but not which angle" when unsure. No talking -> a reaction. | `sort.ts`, `noTalk.ts`, `CampaignApp.tsx` 1976-2006 | |
| Silences cut | Pauses taken out on his pacing (Natural / Balanced / Tight) and his voice. **Frozen (rule zero).** | `plan.ts`, `cuts.ts`, `media/silenceMath.ts`, `pipeline.ts` | |
| "Um"s and stumbles | Found by their sound, cut, and listed on the caption check with "Put back". "Said twice" repeats with "Cut the first". **Frozen.** | `umFind.ts`, `media/fillerWords.ts`, `repeats.ts`; flags in `CaptionReview.tsx` 996-1051 | |
| Captions (burned in) | One word / Highlight / Phrase; Small-Huge; Top / Middle / Usual / Bottom; punctuation option. English or French, told from each video. **Word timing frozen.** | `captions.ts`, `align.ts`, `media/speechLanguage.ts` | |
| Job row | One row per video: status ("Waiting to be listened to", "Listening… 40%", "Needs you", "Approved", done "1:20 → 0:58"), main button (Check captions / Approve / Save / Try again), Remove with 6 s Undo, Stop. | `JobRow.tsx`, `CampaignApp.tsx` | |
| Join suggestion | Two recordings filmed moments apart: "Filmed right before X - Join them"; or "Join with another recording". Split apart again. | `JobRow.tsx` 259-269, `joinRender.ts` | |
| Not-9:16 question | A wide/square clip: "Cut it and make 9:16" or "Only make 9:16 - don't cut". | `WideAsk.tsx`, `framing916.ts` | |
| Check questions | Before the edit screen: Goes to (campaign · angle), Headline + look, Music (+ how long the song is against the video), Pictures in this video, Video before/after/in the middle, "Captions on the hook too". | `CheckQuestions.tsx`, `JobRow.tsx VideoFields`, `ClipsField.tsx`, `songLength.ts` | |
| Caption check (quick) | Claude reads the captions once by itself; cards "1 of 3 to look at": Good / Fix / Undo change; "Every caption looks right"; Watch it once; Approve; "Make it without captions". | `CaptionReview.tsx` 1057-1224, `captionFlags.ts`; server `postiz/recheck.ts` | |
| Caption sheet | All phrases in a see-through sheet (half / three-quarters), editable, "Only show the N to check", Claude check button with its cost. | `CaptionSheet.tsx`, `CaptionReview.tsx` 694-992 | |
| Edit screen (timeline) | TikTok-like: filmstrip clips with words, drag arrows to trim or bring back, Split, Delete, Speed (0.5×-3×), Undo/Redo, full screen, pinch to zoom the timeline. | `EditScreen.tsx`, `CutsEditor.tsx`, `cuts.ts`, `filmstrip.ts`, `timeStretch.ts` | |
| Text | "Text": your words on the video, a look (White box / Outline / Snapchat), dragged and pinched, a bar on the timeline for when it shows. | `CutsEditor.tsx`, `manualPictures.ts`, `render.ts texts` | |
| Overlay | A photo or video from the phone or the banks over you; drag, pinch, a bar for its time. | `CutsEditor.tsx` 2236-2289, `popVideo.ts` | |
| Sound | Sound effects bank, the Cutter's own effects, the music bank or a sound from the phone, placed on the timeline with a volume. | `SoundPicker.tsx`, `render.ts sounds` | |
| Headline | Drag/pinch the headline; Size; "Put back"; the next videos of the angle start where it was left. | `CutsEditor.tsx` 2116-2150, `headlinePlace.ts` | |
| Check (noise) | With "cut sounds that aren't speech" on: "Might be a quiet word", "Short noise"… Listen / Put it back / Cut it. | `CutsEditor.tsx` 2297-2338, `noiseCuts.ts` | |
| Timeline editor (several clips) | Videos -> More ways -> Timeline editor: clips in order, then "Post it" / "Cut the silences" / "Just keep it". | `JoinPicker.tsx`, `CampaignApp.tsx` 3712-3759 | |
| Reaction video | Videos -> More ways -> Reaction video: campaign, headline + look, a product clip, then reaction clips - each one a video. | `CampaignApp.tsx` 4068-4134, `reactionRender.ts` | |
| Making + sending | Approved videos are made one at a time on the phone (or the Cutter server), then sent to Postiz by themselves when the campaign has accounts. "Made, not sent" group for videos no campaign posts. | `render.ts`, `outbox.ts`, `CampaignApp.tsx` 2379, 4238-4272 | |
| Save / Share all | Share sheet for one or all finished videos. | `shareFile.ts`, `JobRow.tsx` | |
| Cut only (plain cutter) | More -> Cut only: Pacing + Fine-tune sliders, "Cut ums and stumbles", "Write captions (.srt)", Share. Nothing posted. **Frozen.** | `src/App.tsx`, `src/media/silenceCut.ts`, `src/ModeNav.tsx` | |

## 3. Campaigns (More -> Campaigns) and the Bank

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Campaign list | Rows with logo, name, "N angles"; General ("Videos with no campaign") always there. New campaign. | `CampaignsView.tsx` 168-201 | |
| Brand & logo | Name, "Its videos": Talking head or Reaction + product (+ the switch sound), brand name as you say it (brings the logo up, told to the listener), logo PNG. | `Editors.tsx` 149-290, `look.ts` | |
| Angles | A kind of video for the brand; a new angle starts as a copy. Tabs Look, Pictures, Sound, Effects, Clips; live preview with TikTok's button areas shaded. | `Editors.tsx` 321-763, `Preview.tsx` | |
| Look: headline | Text (80 max) or "Write it from the video" (Claude, from what you say, in your past style); where, style, outline thickness/colour, size, seconds on screen. "Recognise it by" words. | `Editors.tsx` 424-580, server `postiz/videoHeadline.ts` | |
| Look: logo | "Show the logo when I say <brand>": where, width, seconds. First mention or every one. | `Editors.tsx`, `moments.ts` | |
| Pictures on words | Up to 6 pictures, each brought up by its words; Use the picture bank. | `PictureRow.tsx`, `Editors.tsx` 581-672 | |
| Sound | Background music (Background / Quieter; from the music bank) and up to 6 sounds (Whoosh / Ding / Pop / a file) at the start, on the brand, on words, when a picture comes up; volume meter. | `MusicRow.tsx`, `SoundRow.tsx`, `music.ts`, `sounds.ts` | |
| Effects | Punch-in at cuts, Hook push-in, Brand punch-in (Off / Subtle / Strong), Pop-in; examples on your own video. | `EffectsSection.tsx`, `effects.ts` | |
| Clips | Video before / after / in the middle (after a phrase) on every video of the angle. | `ClipRow.tsx`, `clips.ts`, `cueClips.ts` | |
| Posting rules | Your accounts (+ "Look again", "Most posts a day", "Add to videos already made"); Your times (own times or random window, N a day); Before it posts (I approve / Straight away / Brand approves; submit reminder); Repost reminder; Caption (Claude writes it with the brand's rules + hashtags, or I paste it). | `PostingEditor.tsx`, `posting.ts saveCampaignPlace/attachAccounts` | |
| Captions per kind of video | "Added to the caption, by kind of video": talking head (advanced) and reaction (basic) lines/hashtags - for MediaMaxing-style tracking. Kind worked out by itself. | `PostingEditor.tsx`, `postKind.ts`; server `postiz/caption.ts kindText` | |
| Redo captions | Add the hashtags to posts already made, or rewrite them with the new rules. | `PostingEditor.tsx`, server `postiz/recaption.ts` | |
| Instagram location | A place (Facebook page link / IG location / ID) on every Instagram post, or per campaign. Postiz doesn't pass it on yet. | `InstagramPlace.tsx`, server `postiz/place.ts` | |
| Stop or end a campaign | Stop all its posts; End campaign - free its Postiz accounts (preview of what goes and what stays, and why); Delete campaign. | `CampaignsView.tsx` 137-163, `EndCampaign.tsx`, server `postiz/channels.ts` | |
| Bank: pictures | Logos etc. with the words that bring them up; find by word. | `BankView.tsx` | |
| Bank: videos | Pop-up videos brought up by words (muted, big box). | `VideoBankView.tsx`, `videoBank.ts` | |
| Bank: music + sound effects | Shared by every phone of the login; rename, play, remove. | `MusicBankView.tsx`, `musicBank.ts`; server `cutter/songs.ts` | |

## 4. Posting (Posts tab)

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Not set up | "Set up posting" button. | `CampaignApp.tsx` 4949-4958 | |
| On the way | One line for videos going up / getting ready / Claude writing captions; a stuck one gets Try again / Stop sending. Retries by itself. | `PostsView.tsx` 750-814, `outbox.ts` | |
| To approve | Always on top; "Approve all N"; the first 3 of a batch open with their video. Each: time, campaign, platform marks, caption box, Approve / Post now / Watch / Edit again / Reject; More options: Approve, post later; Change time; Add music; Save video; batch hashtags / rewrite; a caption per platform. | `PostsView.tsx` 211-389, `PlatformIcons.tsx` | |
| 3 yeses trust a batch | The 3rd approval in one batch approves the rest of it. | server `postiz/batch.ts BATCH_TRUST`, `index.ts approveRestOfBatch` | |
| Brand approves | "Save video", send to the brand, then "Brand approved". | `PostsView.tsx` 285-345 | |
| Scheduled, by day | Today and Tomorrow open, later days folded; chips Scheduled / Going out / Posting again / Posted / Partly / Not posted / Failed; views pill; links per account; Take back; Post again now; Reconnect in Postiz. | `PostsView.tsx` 397-539, `postsList.ts` | |
| Just posted / Didn't go out | Last 3 hours; missed posts folded at the bottom with "Post it myself" (save video + copy caption) or "Let the Cutter post it". | `PostsView.tsx` 542-618 | |
| Missed post notification | A tap opens that post on top (missed sheet). | `PostsView.tsx` 622-668, `public/push-sw.js` | |
| Missed posts go again | At most 2 times by themselves at the next free time (YouTube's good hours when only YouTube missed); YouTube again at 00:10 Pacific. | server `postiz/failed.ts` | |
| Waiting past its time | A post still to approve moves an hour later (9 the next morning after midnight). | server `postiz/slots.ts laterWhileWaiting` | |
| Select -> stop | Tick a whole campaign or posts one by one; Stop N posts (taken out of Postiz). | `StopPicker.tsx` | |
| Campaign filter | "All campaigns · N" dropdown, remembered. | `PostsView.tsx` 1117-1127 | |
| Add music after | Add / change / take off the music on a post not out yet; sent as a new version, the old one removed. | `MusicAfter.tsx`, `musicAfterSend.ts` | |
| Edit again | Reopens cuts, captions and music; replaces the post (or a new post within 2 h after it went out). Batch videos: headline + music. | `PostsView.tsx` 182-209, `BatchEdit.tsx`, `store.ts reopenJob` | |
| New post | Finished videos, no cutting: campaign, a note Claude reads ("post it tomorrow"), captions written from stills, When: Post now / Pick a time / Spread them (N a day, weekends) / One by one; duplicates refused unless "Add anyway". | `NewPost.tsx`, server `postiz/hand.ts`, `handNote.ts` | |
| Pause and daily limits | Per platform and per account: pause switch and a most-a-day; held videos go out when free. | `PostingLimits.tsx`, server `postiz/limits.ts` | |
| Buffer backup | Buffer key(s) back up Instagram accounts when Postiz fails; "Postiz is down" switch hands posts over. A login can post through Buffer only. | `BufferBackup.tsx`, server `postiz/buffer.ts` | |
| Video covers | Each video's cover is its own moment per account. | server `postiz/cover.ts` | |
| Notifications | Posts to approve, batch ready, missed post, submit reminder, repost reminder, daily summary, shadowban warning, server trouble. | `push.ts`, `public/push-sw.js`; server `postiz/index.ts notify*`, `summary.ts` | |

## 5. Batches (Batch tab)

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Campaign card | Which campaign's batch, its accounts and times; picker when several. | `BatchView.tsx` 2149-2182 | |
| Status card | Making videos / Waiting its turn / Up to date / About to make more / Not making new videos / Paused / Something is wrong / The server went quiet / N couldn't be made; the Now bar; next days strip (ready / target, Off days); Make now, Stop, Stop and take out the N scheduled. | `BatchStatus.tsx`, `batchNow.ts`, `BatchView.tsx` 2088-2229 | |
| Formats | Reaction, Talking head, Green screen - several of each; "+ Add a format"; each card shows clips, steps, "N different videos left", Paused, its share of the day. | `BatchView.tsx` 1571-1868, `batch.ts BatchFormat` | |
| Reaction / green screen format | You clips (+ use each once), Headline on top, green screen corner/size/voice, product clips or steps, "Same product as…", Pause, Take out. | `BatchView.tsx` 1591-1868 | |
| Talking head format | Drop in clips, Speed (1×-1.5×), Your clips in play order (Hook, then each step with Cut / Raw), How the videos look (headline, music, captions look + height, Edit my hooks, Dropped clips can be hooks), Steps and rules. | `BatchView.tsx` 1342-1540, `TalkClips.tsx` | |
| Drop in + checklist | Pick every clip at once; Cut the clips / Zoom / Captions / Music / Headline / Mirror them (remembered); each clip goes to the step it names. On the Cutter server when it is up. | `DropIn.tsx`, `dropQueue.ts`, `prepareDrop.ts`, `stepMatch.ts` | |
| Clip check | One clip at a time, full screen: where it goes (steps, Hook, Leave out), "Sounds like step N · Move it", Mirror, Cut / Raw, the Cutter's caption check, Timeline editor, Approve & next. | `DropCheck.tsx` | |
| Clip screen | Tap a clip: plays whole, big ‹ › and X, Length (its timeline), Cut / Raw, Speed for this clip, In (move), Mirror, Captions, Replace, Remove. | `ClipEditor.tsx`, `clipEdit.ts` | |
| Cut / Raw per step | One tap makes every clip of a step cut or as filmed, in the background. | `TalkClips.tsx SpeedRunner`, `clipEdit.clipsToSwitch` | |
| Product steps | Names and order (+ Add step); each step's Words & overlays on a phone screen (snap to centre); use each clip once. | `StepOrder.tsx`, `StepTexts.tsx`, `stepOverlays.ts`, `stepPiece.ts` | |
| Captions height | Drag the captions up or down for every video of the format. | `CaptionHeight.tsx` | |
| Hook looks | White box / Outline / Snapchat / Claude + X, in shares (−/+ %). Claude + X: two logos and an amount a day, a headline or nothing. Headlines, one a line. | `BatchView.tsx` 2305-2463, `FormulaPreview.tsx`, `formulaOverlay.ts` | |
| Music | Songs for the batch (or from the music bank), each marked for the formats that use it. | `BatchView.tsx` 2464-2478, 1915-2035 | |
| How often / Videos a day | Every day (N a day, up to 48; "More each day" +N) or Some days (days of the week, N on each). Times spread evenly round the clock or the campaign's times. | `BatchView.tsx` 2483-2645, `batch.ts weekPlan`, `window.ts` | |
| Start / Start anyway / Start over | Start makes the next 3 days and keeps going; Start anyway makes mixes made before again; Start over takes out what hasn't gone out to remake it with the latest settings. | `BatchView.tsx` 2037-2702, `batchRun.ts` | |
| Variations | "N variations" and what multiplies into it; "N still to make - D days at N a day". | `BatchView.tsx` 2785-2799, `batchRun.ts` 281-325 | |
| Failed list | "N couldn't be made" with Try again / Skip. | `BatchView.tsx` 2762-2784 | |
| Time to film new ones | Every different video made: the footage is cleared and he is told to film new clips. | `BatchView.tsx` 2233-2244 | |
| The Cutter server | Settings -> Server: the app on his own server makes every batch day and night with the phone closed; clips go up while the app is open. | `serverLink.ts`, `serverMode.ts`, `server/main.mjs`, `SettingsView.tsx` 495-592 | |
| The engine (old) | Batch "On the engine" - only on a phone already connected to it. | `engine.ts`, `engine/`, `BatchView.tsx` 2248-2265 | |
| Edit a batch video | From Posts: headline + music, "Make it again". | `BatchEdit.tsx` | |

## 6. Formats tab and One video, new songs

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Formats list | More -> Formats: a campaign's formats ("N ready · N making"); + New format -> Look & clips editor. | `FormatsView.tsx` 99-245 | |
| Script | Lines in order, each with its takes (+ Takes); ↑ ✕; "+ Add line". | `FormatsView.tsx` 517-587, `formats.ts` | |
| Make N videos | Each take of line 1 opens one video, with one take of every other line (least used, filmed closest). | `formats.ts mixesOf`, `CampaignApp.makeFormat` | |
| Ready -> brand -> schedule | Ready videos: Watch, Save (all to the phone, to send the brand); "Brand said yes?" -> Over the month / Schedule for the week / Next 5 days at the campaign's times, no approving again. | `FormatsView.tsx` 606-698, `CampaignApp.scheduleFormat` | |
| One video, new songs | Batch tab card: a video that did well, posted again with each of the batch's songs (picture untouched; your voice kept with the song under it, or song only). Copies of each, Stop / Go on. | `CopiesCard.tsx`, `songSwap.ts`, `copyTalk.ts`, `batchRun.planCopies` | |

## 7. Analytics and What works

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Last 30 days | Big total of views, "+N today", best day, a line that only climbs; "N videos out in N days" with a "% went out" pill and Posted / Scheduled / To approve / Didn't go out. | `Overview.tsx`; server `postiz/month.ts` | |
| Per-campaign cards | Only campaigns with a batch: "views a video", trend "▲ 12% on last week", the batch's rate. | `AnalyticsView.tsx`, `analytics.ts` | |
| Ready for more a day? | "Ready for 5 a day?" (views up 20%, or at your target) / "Try 3 a day?" (down 30%); Yes changes the batch at once; Not now; quiet 3 days after. Target: "Suggest more a day at N views a video". Dot on the tab while one waits. | `AnalyticsView.tsx` 172-234, `analytics.ts suggestRate` | |
| When to post | Heat map of the best hours by day (after 150 videos); batch times crowd toward them (up to 2×), Turn on / off. | `WhatWorks.tsx` 38-101; server `postiz/bestHours.ts` | |
| What works | Views a video by headline, reaction, song and headline look: ★ Best / Worst bars; "Use the best hooks" (best ones twice as often) / "Back to even"; "Write more like the best" headline ideas with Add. | `WhatWorks.tsx` 103-312, `batchFavour.ts`; server `postiz/hookInsights.ts`, `headlineIdeas.ts` | |
| Accounts that stopped getting views | Possible shadowban: "About 40 views a video lately - it usually gets 900"; Pause / Resume; "Post an extra warm-up on it?" | `WhatWorks.tsx` 151-202, `ColdWarmup.tsx`; server `postiz/deadAccounts.ts` | |

## 8. Trial reels (owner, and logins the owner turns it on for)

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Who sees it | More -> Trial reels only when the server says Trial reels are on for the login (the owner always). A "Trial reels only" login sees just Trial reels and Posts. | `MoreView.tsx`, `CampaignApp.tsx` 5120-5185; server `postiz/trial.ts` | |
| Start a Trial loop: viral reel | Pick the viral reel and the same clip with no text/sound; the Cutter finds where it starts, takes its sound, Claude reads its words and writes rewordings; the account it goes to. | `TrialView.tsx` 829-924, `viralReel.ts`, `trialLoop.ts`; server `trial-read` | |
| Start a Trial loop: talking clip | Your talking video + songs from the music bank: caption check, Claude writes headlines (take out / add your own), cut once; each copy a headline and song in turn. | `TrialTalkStart.tsx`, `trialTalk.ts`; server `postiz/trialHeadlines.ts` | |
| Copies | Videos a day (default 30; −5 / +5); each copy differs (words exact or reworded, moved, brightness, length); posted as Instagram Trial Reels (non-followers only). Approve 3 copies of a reel and the rest go by themselves. To approve / Going out / Out lists; Watch, Reject, Take out. | `TrialView.tsx` 64-190, 728-812 | |
| Status, Make again, Stop | The batch status card; Try again; Stop everything; Make again (every copy not out yet remade); Stop one reel. | `TrialView.tsx`, `BatchStatus.tsx` | |
| Instagram's limits learned | The daily trial limit Instagram shows is learnt and kept to; an account that can't post trials makes nothing until one goes through. | server `postiz/index.ts learnFromTrial`, `trialLoop.ts` | |

## 9. Motion graphics and Warm-ups

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Motion graphics: pick | More -> Motion graphics: Which look (Claude picks / Format 1 Board / Format 2 Glass), "What you want (optional)" with example chips, pick a talking video. Only the words go to Claude. | `MotionView.tsx` 207-233, `motion/FormatPicker.tsx` | |
| Motion graphics: plan | Cut like on Videos, caption check, Claude plans (20 s - 1 min); plan screen: Play it live over the video, moments list (Title, cards, board, glass, steps, compare, call to action), tap one to change its words or take it out, sound effects on/off, switch look, Another plan, chat "Tell Claude what to change", cost so far. | `MotionView.tsx` 344-1034, `motion/*`; server `postiz/motion.ts` | |
| Motion graphics: make | Made on the phone, then Save / share (post it with New post). Every step kept on the phone - reopening goes back to it. | `motion/make.ts`, `motion/session.ts` | |
| Warm-ups: ideas | Shared ideas (headline, sound, ~7 s, how to film it, an example link or video) in categories; + Idea, + Category; anyone adds, the owner approves (partners' go up at once). | `WarmupView.tsx`, `warmups.ts`; server `cutter/warmups.ts` | |
| Warm-ups: film | "Film N in one go": the idea's sound plays while you film, it stops by itself; made and kept until it goes out. | `WarmupFilm.tsx`, `warmupMake.ts`, `Recorder.tsx limitSec` | |
| Warm-ups: where they go | Per campaign: on/off, N a week, categories; each goes once, at the account's best hour, on top of the batch, waiting for your OK. Accounts gone cold: extra warm-up on Yes; a quiet account (nothing in 24 h) gets one by itself. | `WarmupView.tsx` 259-308, `warmupPlan.ts`, `warmupSend.ts`; server `postiz/batch.warmupOf` | |

## 10. Settings (More -> Settings)

| Feature | What it does | Where | Tested |
|---|---|---|---|
| Account card | Name, sync status, Sign in / Sign out. | `SettingsView.tsx` 459-491 | |
| Posting | Set up / Change keys; "Send finished videos from this phone"; "Random times for every campaign" (Switch all); Pause and daily limits; Buffer backup; Instagram location; Notifications (Turn on; Home Screen needed on iPhone); Disconnect this phone. | `SettingsView.tsx` 235-318, `push.ts` | |
| Your voice | Voices list (Automatic or pinned), + Voice; "Make my voice louder and clearer"; old "um" switch. | `SettingsView.tsx` 320-341, `VoiceSetup.tsx` | |
| Cutting | Pacing; Wide clips: Fit (default) / Fill / Off; "Also cut sounds that aren't speech". | `SettingsView.tsx` 343-355, `framing916.ts`, `noiseSetting.ts` | |
| Captions | Captions on the videos; Leave out punctuation. | `SettingsView.tsx` 357-380 | |
| Default effects | Off / Subtle / Strong, or a custom mix. | `SettingsView.tsx` 75-117, `defaultEffects.ts` | |
| Server / Engine | See section 5. | `SettingsView.tsx` 495-665 | |
| People (owner) | Each login: link state, phones (Remove), Pause, Trial reels on/off, Partner; make a one-time sign-in link (or Trial reels only). | `People.tsx`, `cloud.ts`; server `cutter/index.ts` | |
| Look | Dark / Light; Show tips (off by default - every grey hint). | `SettingsView.tsx` 668-710, `src/theme.ts` | |
| Space | Storage used on the phone. | `SettingsView.tsx` 393-419, `storageReport.ts` | |

## 11. Things the app does by itself

- **Listens to every video**, sorts it into its campaign and angle, finds reactions (no talking), writes the headline
  from the video when the angle asks for it, and checks the captions with Claude once per video.
- **Makes approved videos one at a time** (approved first), keeps the screen on while working, retries once, falls
  back to a plain cut if the look can't be added, restarts itself when the phone runs out of memory or stops, and
  picks unfinished videos back up.
- **Sends finished videos to Postiz** in parts, resuming after a lost connection, one post per video whatever happens
  (a video has a key; sending twice makes one post); retries 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min.
- **Uses the Cutter server** (when connected) for 3+ talking videos waiting, and for every batch, day and night.
- **Keeps batches going**: the next 3 days made when the app opens, comes back on screen and every 30 min (or on
  the server); lowering the number takes the extra out; formats share each day; times spread evenly round the clock
  (more at the best hours); rejected videos are replaced; when all different videos are made, the footage is cleared
  and he is told to film new ones.
- **Server side, every 5 minutes**: schedules due posts, moves waiting posts an hour on, posts missed ones again (at
  most twice), releases held posts when a limit frees, reads views (a day, 3 days, a week after), learns best hours,
  warns about accounts that stopped getting views, hands posts to Buffer when Postiz fails, sends the morning summary.
- **Notifications**: posts to approve (at most every 10 min), batch ready / last videos, warm-up to approve, a post
  failed / didn't go out, submit within 2 h, repost reminder, morning summary, shadowban warning, Trial reels
  limits, server trouble, and (owner) new phones.
- **Shares setups** (campaigns, angles, bank, music) between the phones of a login; videos stay on the phone.
- **Updates itself** only at a moment nothing would be lost.

## 12. Found while mapping (checked in Phase 3)

Copy and small UI problems the code reading turned up. Each is checked in Phase 3 and either fixed or listed as a
question for the owner.

1. Caption check button says "about about 3¢ of credits" (`CaptionReview.tsx` 781 + `captionFlags.centsLabel`).
2. Quick check says "Claude read them all and found nothing to fix." even when Claude never ran (no posting set
   up) (`CaptionReview.tsx` 1132).
3. Batch tab: "Change a look on the videos not out yet ↓" scrolls to `#hook-results`, a section that was taken out
   (`BatchView.tsx` 2199-2204).
4. Timeline editor hint says "(+ Overlay, + Text)" but the buttons are "Overlay" and "Text" (`JoinPicker.tsx` 180).
5. "More → Music" doesn't exist: Trial talking clips and Motion graphics point there (`TrialTalkStart.tsx` 245,
   `MotionView.tsx` 306); music is under More → Bank.
6. Sign-out confirm says setups "just stop being shared" - signing out now closes the app to the sign-in page
   (`CampaignApp.tsx` 5070).
7. The owner's "new phone" notification opens Posts, not Settings → People (`CampaignApp.tsx` 1229, 1439).
8. The owner's name is in a server error other logins see ("Ask Ziad to take one off", `cutter/index.ts` 399).
9. A "Trial reels only" login has no way to turn notifications on (the switch is in Settings, which it doesn't have).
10. The Notifications line says only "Posts to approve, and reminders to submit"; the blocked line says "iPhone
    Settings" on every phone.
11. Unreachable UI kept in the code: Clips + music maker (`ClipsMaker.tsx`), "Add videos for {label}", talking-head
    controls inside the generic format card, "Watch every clip", automatic weak-hook dropping.
12. Tapping a campaign badge on Videos opens the campaign list, not that campaign (`HomeTop.tsx`, `CampaignApp.tsx`
    4045).
13. Back from the standalone "Edit cuts" editor throws the changes away; back from the edit screen keeps them.

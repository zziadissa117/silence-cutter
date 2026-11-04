# Trial Reels and Meta's originality rules - research (2026-11-04)

Research only, no code changed. Written for the admin-only feature the owner
asked about. Every fact says where it comes from and how sure it is.

**How it was checked.** This cloud session could not open
`developers.facebook.com`, `creators.instagram.com` or `docs.postiz.com`
(blocked by its network settings), so Meta's own pages were read only through
search-engine extracts. Postiz was checked in its **source code** (cloned from
GitHub, main as of 2026-11-03), which is the strongest evidence here.
Labels used below:

- **[Meta]** Meta / Instagram / Facebook's own page or announcement.
- **[Code]** read in Postiz's source code.
- **[Press]** reputable reporting (TechCrunch, Engadget, PetaPixel, Tubefilter...).
- **[Vendor]** a scheduling tool's blog or help page - often right, not official.
- **[Unconfirmed]** repeated online, nothing official found.

---

## 1. Trial Reels - what they are

| Fact | Source, date |
|---|---|
| A Trial Reel is shown **only to non-followers** first. Followers don't see it in their feed or on the profile grid (someone can still send it to them). | [Meta] [about.fb.com, 2024-12-10](https://about.fb.com/news/2024/12/trial-reels-try-content-non-followers-first/); [TechCrunch 2024-12-10](https://techcrunch.com/2024/12/10/instagram-rolls-out-trial-reels-that-arent-shown-to-a-creators-followers) |
| Stats (views, likes, comments, shares, compared with earlier trials) appear about **24 h** after posting. | [Meta] launch post, same link |
| Two ways to "graduate" (be shown to followers too): **share it yourself** any time, or turn on **auto-share**: Instagram shares it "if it's performing well soon after you publish it, based on signals like views and engagement". The setting sticks for future trials. | [Meta help page, quoted by Planoly](https://www.planoly.com/blog/trial-reels-auto-share-vs-manual.md) |
| Auto-share looks at the **first ~72 hours**. The exact threshold is **not published**. | [Vendor] [Storrito](https://storrito.com/resources/how-instagram-trial-reels-work-72-hours/), [Planoly](https://www.planoly.com/blog/trial-reels-auto-share-vs-manual.md) - Meta gives no number |
| Who can use it: **public professional accounts** (Creator/Business) that are **eligible for recommendations**. Lose recommendation eligibility (e.g. for unoriginal content) and you lose Trial Reels too. Follower minimum: reported as **1,000** by press; some guides say 200 for professional accounts. | [Press] [Social Media Today](https://www.socialmediatoday.com/news/instagram-expands-access-trial-reels/752895/), [Social Samosa](https://www.socialsamosa.com/news-2/instagram-introduces-wider-access-trial-reels-9493132); threshold **[Unconfirmed]** |
| Mosseri: Trial Reels **almost always get less reach** than normal Reels (no early push from followers) and can be slower to pick up. | [Press] reported via [Planoly](https://www.planoly.com/blog/are-instagram-trial-reels-worth-it) |
| No collab partners on a Trial Reel; one video only. | [Vendor] + [Code] (Postiz refuses a trial with more than one file or no video) |
| A daily cap on trials exists through the API (Meta error code 9 / subcode **2207078**, "Trial Reel publish limit reached"). Size of the cap: **~20 a day** per account is reported. | Error code: [Code] [Postiz PR #2215, merged 2026-10-07](https://github.com/gitroomhq/postiz-app/pull/2215). The 20: **[Unconfirmed]** |
| An account that isn't eligible gets subcode **2207081** ("This account doesn't support Trial Reels") **when the post is published**, not when it's scheduled. Waiting or reconnecting doesn't fix it. | [Code] Postiz `instagram.provider.ts`; [GitHub issue, c10dev/fanout #112](https://github.com/c10dev/fanout/issues/112) |

## 2. Can we post Trial Reels through the API?

**Yes - and through Postiz, which we already use.**

- **Instagram Graph API** [Meta, via search extracts + every tool that implements
  it]: the Reels container (`POST /{ig-user-id}/media`, `media_type=REELS`) takes
  `trial_params={"graduation_strategy": "MANUAL" | "SS_PERFORMANCE"}`.
  - `MANUAL`: stays a trial until someone taps "share to followers" **in the Instagram app**.
  - `SS_PERFORMANCE`: Instagram's own auto-share (graduates it if it does well).
- **There is no API call to graduate a trial later.** I found nothing in Meta's docs,
  Postiz, or any other tool that does it. So "the Cutter decides from the views and
  graduates it" is **not possible** today; the only automatic graduation is
  Instagram's own (`SS_PERFORMANCE`). [Not found anywhere - treat as "not available"]
- **Postiz** [Code, main 2026-11-03]: both Instagram providers (`instagram` and
  `instagram-standalone`) read two post settings and pass them straight to Meta:
  `is_trial_reel: true` and `graduation_strategy: 'MANUAL' | 'SS_PERFORMANCE'`
  (default MANUAL). It also turns Meta's two trial errors into readable messages.
  The public API's `POST /posts` takes these settings like any other.
- **Our server already sends** `is_trial_reel: false` on every Instagram post
  (`supabase/functions/postiz/index.ts`, `settingsFor`). Turning trials on is a
  small server change, no patch to Postiz needed (unlike `docs/postiz-location`).
- **Per-video views** already come back: `postiz/postViews.ts` reads
  `GET /analytics/post/:postId` at 24 h, 72 h and 7 days. Whether Instagram's
  numbers for a trial say "non-followers only" or whether it graduated is
  **not known** - needs one real test.
- **Buffer** (our backup when Postiz is down): its help pages show Reels with
  "Share to feed" but **nothing confirms Trial Reels through its API**
  ([Buffer help](https://support.buffer.com/articles/scheduling-instagram-posts-reels-stories-and-notifications-3XA98S9Q5p);
  Planoly lists Buffer with trial options in its app [Vendor]). So a video
  handed to Buffer would go out as a **normal Reel**.

## 3. Meta's originality / repost rules

### What Meta actually says

| Rule | Source, date |
|---|---|
| **Instagram, 2026-04-30**: accounts that **primarily** post unoriginal content - now photos and carousels too, not only Reels - are **no longer shown in recommendations** (Explore, Reels tab, suggested). Followers still see them. Account-wide, not per post. | [Meta] [Instagram for Creators blog](https://creators.instagram.com/blog/rewarding-original-creators-on-instagram); [TechCrunch](https://techcrunch.com/2026/04/30/instagram-restricts-reach-of-content-aggregators-in-new-crackdown/), [PetaPixel](https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/), [Tubefilter](https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator) |
| Way back: become eligible again once **most posts of the last 30 days** are original. Check / appeal in **Settings → Account Status**. | [Meta] same blog post; [Account Status help](https://help.instagram.com/539126347315373) |
| What counts as unoriginal: content you "didn't create or enhance in a material way" (Instagram users' content). Edits count only if they **meaningfully enhance** it: overlaid text that does more than describe the picture, or narration / story / graphics that **re-contextualise or add information**. A new caption, border, watermark or subtitles alone is **not** enough. | [Meta] [Original Content Guidelines](https://creators.instagram.com/original-content-guidelines/) (via extract); [Digital Camera World](https://www.digitalcameraworld.com/tech/social-media/two-years-later-instagram-is-finally-giving-photographers-the-same-protection-as-videographers-with-this-key-change) |
| When two **identical** Reels are found, Instagram recommends the **original** instead of the copy, and labels reposts with a credit to the original (Reels, since 2024). | [Press] [House of Marketers](https://houseofmarketers.com/instagram-reels-algorithm-update-original-content/), [Engadget](https://www.engadget.com/instagrams-algorithm-overhaul-will-reward-original-content-and-penalize-aggregators-130018977.html) - date of the Reels change not confirmed on a Meta page |
| "10 or more unoriginal posts in 30 days" as the line for losing recommendations. | [Press] cited from Instagram's 2024 wording - **not** in the 2026 post, which says "primarily" |
| **Other apps' watermarks** (TikTok logo etc.) are not recommended; your **own** logo is fine. | [Meta] Mosseri, via [Social Media Today](https://www.socialmediatoday.com/news/instagram-clarifies-including-your-own-logo-on-a-reel-is-ok/730852/) |
| **Facebook, 2025-07-14**: accounts that repeatedly reuse others' videos/photos/text lose **monetization** for a while and get **less reach on everything**; duplicate videos get less distribution so the original keeps the views. Reactions, commentary, joining trends are fine; watermarks and simple crops are not "enough". Status in the Professional Dashboard / Support Home. | [Meta] [Facebook creators blog](https://creators.facebook.com/blog/supporting-original-content-on-facebook); [Tubefilter](https://www.tubefilter.com/2025/07/15/ai-slop-unoriginal-repetitive-content-monetization-facebook-meta/), [Social Media Today](https://www.socialmediatoday.com/news/facebook-cracking-down-unoriginal-content-ai-replicas/753001/) |

### How detection works

Meta **does not say**. Claims like "same file hash = duplicate" or "no
cross-platform matching" are blog guesses [Unconfirmed]. Safe assumption:
Meta matches what the video looks and sounds like, not the file bytes, so
re-encoding or a different file name changes nothing.

### The part that matters for us: the same video on many of his own accounts

- **Meta has published nothing** that speaks directly to posting your *own*
  video on several accounts you run. I found no Meta page or Mosseri quote on it.
- What is official: the rule is about content **already on Instagram** that
  wasn't **created or meaningfully enhanced** by the poster, and the identical-copy
  rule keeps the **first** one and demotes the copies. Read plainly, an identical
  video on account B after account A posted it looks like a copy to the system,
  whoever owns both - several blogs read it that way too [Unconfirmed].
- Meta's spam / inauthentic-behaviour rules exist, but the "many accounts posting
  the same thing at once" detection described online is **not** from Meta [Unconfirmed].
- Losing recommendations also means **losing Trial Reels** on that account
  (trials need recommendation eligibility) - the two features are linked.

**Bottom line:** his batch videos are his own footage, made new (different hook,
headline, music, order of steps), which is the "meaningfully edited" side. The risk
is a video that is **the same picture and sound** on several accounts, or an
account that posts mostly near-copies. Nobody outside Meta can say how close is
"too close".

## 4. What this means for the Cutter - ideas, ranked

Ranked by value for least input / most output, and what's possible today.

1. **Batch videos go out as Trial Reels, Instagram graduates the good ones by itself**
   (`SS_PERFORMANCE`). *Possible today.* Server change in `settingsFor`, an
   admin-only switch per campaign or per account. Zero taps per video for him.
   Risk: trials get less reach; Instagram's threshold is secret.
2. **"Trial first" with fallbacks, no errors for him.** When Meta says
   2207081 (account not eligible) or 2207078 (trial cap hit), the server re-sends
   that one video as a normal Reel and remembers the account isn't eligible.
   *Possible today* (Postiz returns the message; we'd catch it on the failed post -
   `postiz/failed.ts` already reads failed accounts). Buffer hand-overs go as normal Reels.
3. **Originality check before a batch posts.** Compare each new batch video
   with what that **campaign already posted** and what's going to **other accounts
   today**: same hook clip + same headline + same song + same step order = "too close".
   The app already knows all of these pieces from the plan (`batch.ts` combos),
   so no video has to be re-analysed. Act automatically: don't send the same
   combo to two accounts the same day, and keep each account's last 30 days mostly
   fresh combos. *Possible today*, all on the phone/server, no new service.
4. **"How original is this account" card (admins).** Per Instagram account: share of
   the last 30 days that were fresh combos, flags when one went out near-identical.
   Mirrors Meta's 30-day window. *Possible today.*
5. **Graduation report.** For each trial: views at 24 h / 72 h (already read by
   `postViews.ts`) and which ones looked like winners - a list of "share these
   to followers" if he wants manual graduation. *Partly possible:* reading works;
   graduating them still has to be a tap **in Instagram** (no API).
   We don't yet know if views tell us that it graduated - needs a test.
6. **Learn from trials.** Feed trial results into "Use the best hooks"
   (`batchFavour.ts`) - non-follower views are a cleaner test of a hook than
   follower views. *Possible once 1 and 5 exist.*
7. **Warnings that need no input**: other-app watermark in a bank clip (TikTok/CapCut
   logo) - *hard* (needs image recognition; skip for now); account lost
   recommendations - *not possible*: Account Status isn't in the API; best we can do
   is `postiz/deadAccounts.ts` (views suddenly dropping), which already exists.

**Not possible with our stack today:** graduating a trial from our server;
reading Account Status / "recommendation eligible"; knowing Meta's exact duplicate
threshold; trials through Buffer.

## 5. "Admins only" - how it fits the login rules

Today (`supabase/functions/cutter/index.ts`):

- **The owner** = the oldest space. The **admin backup** (`admin` name +
  secret) is a second way into **the same** space. Logins made with his one-time
  links are **other** spaces (e.g. his friend's).
- Owner-only actions already exist: `invite`, `people`, `pause`, `remove-device`
  check `spaceId === ownerSpace()` on the server and answer 403 otherwise. The
  postiz function has the same idea (`ownerSpaceId` in `spaceFor`).

So "admin" = **the owner's space** (his login or the admin backup), and the
switch fits like `people`:

- The **server decides**, never the phone: the postiz function only sends
  `is_trial_reel: true` when the post belongs to the owner's space *and* the
  setting is on. Another login can't turn it on even by sending a crafted request.
- The setting lives in the owner's profile `settings` (like `instagramPlace`),
  read only by the server; no new table, no new grant, no new login type - nothing
  in AGENTS.md rule 1 changes.
- The phone shows the Settings card only if the server says this login is the
  owner (same way `People` shows today).
- Question for him: should his friend's login ever get it? If "never", nothing else
  is needed. If "later", that's a per-login flag he sets in People - still server-side.

## 6. Proposed plan (nothing built until he says OK)

1. **One real test first (no code):** in the Instagram app, post one trial on one
   account the Cutter uses. Confirms the account is eligible. Then I do one test
   video through Postiz with `SS_PERFORMANCE` on one account, and we check the
   views the Cutter reads for it at 24 h / 72 h.
2. **Admin switch "Batch videos as Trial Reels"** (Settings, owner only):
   off / on with Instagram auto-sharing the good ones. Server-side check, fallback
   to a normal Reel on 2207081 / 2207078, Buffer stays normal Reels.
3. **Originality guard** (on by default, no setting): never the same combo on two
   accounts the same day; each account's 30 days kept mostly fresh.
4. **Admin card**: trials and how they did, originality per account.
5. Later: trial results feed "Use the best hooks".

## Questions for him

1. Trial Reels for **all** batch videos on Instagram, or only some accounts /
   campaigns? (Fewer reach per trial is the trade-off.)
2. Graduation: let **Instagram decide** (no taps), or **manual** with the Cutter
   giving a list of winners to tap in Instagram?
3. "Admins" = only **your** login (and the admin backup), right? Should the friend's
   login ever get it?
4. Are all his Instagram accounts **professional** (Creator/Business) with enough
   followers? New ones may not be allowed trials yet - the app would post those normally.
5. The originality guard changes what goes where (spreads combos across accounts) -
   OK to have it on by default?
6. If more official detail is wanted: allow `developers.facebook.com` and
   `creators.instagram.com` in this environment's network settings and I'll
   re-check every [Unconfirmed] item against Meta's own pages.

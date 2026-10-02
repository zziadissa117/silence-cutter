# Proposal: cutter → planner "posted" bridge (NOT built - needs your OK)

Goal: when the cutter posts a video, the planner's Post grid box for that campaign
ticks itself, so you never tick twice and earnings count once.

## What exists today
- Both apps share one Supabase project. The planner's tables are per-user (RLS);
  the cutter's `cutter_*` tables are server-only (service role), by design.
- A cutter post that went out has: `status = 'posted'`, `campaign_id` / `campaign_name`
  (cutter's own), `accounts` (name + platform), `release_urls`, `updated_at`.
- Nothing links a cutter campaign to a planner campaign, and nothing tells the planner
  which planner user owns the cutter profile.

## Proposed design
1. **Mapping (one-time, by you):** in the planner's campaign page, pick "Cutter
   campaign" from a list (read through the bridge function below). Stored as a nullable
   `campaigns.cutter_campaign_id` (a planner schema change - shown to you first).
2. **Bridge function:** a planner Edge Function `cutter-posted` (signed-in planner
   user only) that asks the cutter side for posts with `status='posted'` since a given
   time, **only for the planner user you designate as owner** (a single allow-listed
   user id in a Supabase secret). Other planner users get an empty list - the 10+ people
   you share the planner with never see your cutter data.
3. **Auto-tick:** the planner calls `cutter-posted` when it opens and on a timer, and for
   each new post records a `video_post` via the existing local-first path with a
   deterministic client key `cutter-<post id>`, so it is idempotent and never double-counts.
   Reposts (`repost_of` set, see `supabase/proposed/`) are skipped.
4. **Honest about what it knows:** it records "posted" only when the cutter's own status is
   `posted` with release links - never a guess from "scheduled".

## What I need from you
- OK to add `campaigns.cutter_campaign_id` to the planner schema (I'll show the SQL first).
- Which planner account is yours (its email), for the allow-list.
- Confirm: a post to several accounts is still ONE deliverable (as the planner's rules say),
  ticked once per account box that matches.

## Not doing
- No SupabaseAdapter, no direct table access from the planner browser, no copying the
  cutter's tables into the planner.

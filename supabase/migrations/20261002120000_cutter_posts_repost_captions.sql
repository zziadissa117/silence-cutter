-- Applied to the live project (uykuoibqdxmpbbrsmyad) on 2026-10-02 after the owner approved it.
-- Two things on cutter_posts, both only adding nullable columns (no data
-- rewritten, nothing dropped, existing rows and code unaffected):
--
-- 1. Auto-repost (Phase 2.2). A campaign can opt in (that switch lives in the
--    campaign's posting rules, already a jsonb, so it needs no column). When a
--    post goes out, repost_at is set to when its repost is due. The scheduler
--    then makes a new post from the same video with a varied caption and links
--    it back with repost_of, so anything counting posts (the planner) can skip
--    reposts and never pay for one video twice. reposted_at stops it happening
--    twice.
--
-- 2. Per-platform captions (Phase 4.1). captions is { "<account id>": { caption,
--    title } } overriding the post's one caption for that account only, so a
--    caption can differ per platform without re-rendering the video.
--
-- Re-runnable.

alter table public.cutter_posts
  add column if not exists repost_of   uuid references public.cutter_posts(id) on delete set null,
  add column if not exists repost_at   timestamptz,
  add column if not exists reposted_at timestamptz,
  add column if not exists captions    jsonb;

-- The scheduler's "who is due a repost" lookup, and "is this a repost".
create index if not exists cutter_posts_repost_due
  on public.cutter_posts (repost_at)
  where repost_at is not null and reposted_at is null;
create index if not exists cutter_posts_repost_of
  on public.cutter_posts (repost_of)
  where repost_of is not null;

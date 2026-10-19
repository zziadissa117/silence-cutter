-- Each posted video's views, per account, read from Postiz (postiz/postViews.ts)
-- a few times over its first week, for the planner's views tracker: a video
-- counts toward its campaign once any one account reaches the campaign's
-- minimum (the planner's campaigns.min_views). Shown to and approved by the
-- owner 2026-10-19. Server-only like every cutter_* column: RLS on, no
-- policies, no grants.
--
-- views: { "<account name>": number } - the latest reading per account.
-- views_at: when they were last read; null until the first reading.
alter table public.cutter_posts
  add column if not exists views jsonb,
  add column if not exists views_at timestamptz;

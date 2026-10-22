-- Buffer as a backup for Postiz (postiz/buffer.ts): when Postiz can't post a
-- video, the Instagram accounts Buffer backs up get the same video, caption
-- and time through Buffer. OK'd by the owner 2026-10-22. Server-only like
-- every cutter_* column: RLS on, no policies, no grants.
--
-- cutter_profile_secrets.buffer_keys: his Buffer API keys (one per Buffer
--   account), a JSON list sealed like postiz_key - never sent to the phone.
-- cutter_posts.buffer_ids: { "<postiz account id>": { postId, channelId, at,
--   status?, link? } } - the accounts a post went to through Buffer instead.
alter table public.cutter_profile_secrets
  add column if not exists buffer_keys text;

alter table public.cutter_posts
  add column if not exists buffer_ids jsonb;

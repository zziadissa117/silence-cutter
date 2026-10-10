-- "Approve, post later": the caption is approved, but nothing goes to Postiz
-- until he taps Post - so he can save the video first. The post stays
-- 'waiting' (nothing sends a waiting post); ready_at marks that he has
-- approved it, keeping it out of "posts to approve" and Approve all.
alter table public.cutter_posts add column ready_at timestamptz;

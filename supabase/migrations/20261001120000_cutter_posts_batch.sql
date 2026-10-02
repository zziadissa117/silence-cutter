-- A video from the Batch tab: made days ahead from a campaign's bank, for
-- one of its posting times on one day - {id, date, time, size}, id being
-- the making it came from. Always waits for his approval. batch_told: he
-- has had the one notification for its batch. See functions/postiz/batch.ts.
alter table public.cutter_posts add column batch jsonb;
alter table public.cutter_posts add column batch_told boolean not null default false;

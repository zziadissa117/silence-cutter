-- A post he made by hand from the Posts screen's New post: a finished video
-- sent as it is, at the time he picked (or straight away) and never
-- approved again - it takes none of the campaign's own times. What he said
-- the video is about, for Claude to write its caption from when he leaves
-- the caption to it.
alter table public.cutter_posts add column by_hand boolean not null default false;
alter table public.cutter_posts add column about text;

-- Late days: a video whose time is a place in the day's even spread rather
-- than one of the campaign's own times ('late': the day ran late; 'extra':
-- one more than the campaign's times), and videos made for the next days,
-- which are never spread into today. See supabase/functions/postiz/slots.ts.
alter table public.cutter_posts add column spread text check (spread in ('late', 'extra'));
alter table public.cutter_posts add column later boolean not null default false;

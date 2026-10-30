-- The phones each login made with a sign-in link is used on (his ask,
-- 2026-10-30: "Let's say he wants to secretly share it with someone else ...
-- Am I going to know? ... Will he even be able to do it?"). A sign-in names
-- the phone (a random id it keeps); the token is bound to it; a login has at
-- most a few at once (cutter invite.ts MAX_DEVICES), the owner hears of each
-- new one, and can take one off (removed_at) or pause the login. The owner's
-- own login is not limited.
-- RLS on, no policies, no anon/authenticated privileges: only the functions.

create table if not exists public.cutter_devices (
  space_id uuid not null references public.cutter_spaces(id) on delete cascade,
  device_id text not null,
  name text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  removed_at timestamptz,
  primary key (space_id, device_id)
);

alter table public.cutter_devices enable row level security;
revoke all on public.cutter_devices from anon, authenticated;

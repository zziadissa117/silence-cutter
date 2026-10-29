-- One-time sign-in links: the only way a second login comes to exist, and only
-- the owner's login can make one (cutter function `invite`). His words
-- (2026-10-29): "a one-time login. After that link gets clicked once, it's not
-- valid anymore", the link dead after 48 hours, the new person in their own
-- space with their own data, setting their own password.
--
-- A link is a random code; only its SHA-256 is kept. `invited` spaces can't be
-- signed in to; `accept-invite` turns one `active` with the password chosen,
-- and clears the code in the same update, so a link works once.
-- RLS stays on with no policies: only the cutter function reads this table.

alter table public.cutter_spaces
  add column if not exists status text not null default 'active'
    check (status in ('active', 'invited', 'paused')),
  add column if not exists invite_hash text,
  add column if not exists invite_until timestamptz;

create unique index if not exists cutter_spaces_invite_hash
  on public.cutter_spaces (invite_hash) where invite_hash is not null;

-- The silence cutter's login and sync tables, and its file bucket - as they
-- were made BY HAND on the live project (uykuoibqdxmpbbrsmyad) in September
-- 2026, before any migration file existed. Written down on 2026-11-10 from
-- the live schema (information_schema, pg_constraint, pg_indexes,
-- storage.buckets) so the migrations start from tables that exist; it has
-- NOT been applied there, and every statement is harmless if it ever is.
-- Columns added later by hand have their own files (20261029 the invite
-- columns on cutter_spaces, 20261030 cutter_devices).
--
-- Like every cutter_* table: row level security on, no policies, and no
-- privileges for anon or authenticated - only the service role, which is the
-- two Edge Functions (supabase/functions/cutter, supabase/functions/postiz),
-- reads or writes any of it. See AGENTS.md, hard rule 1.

-- One login - a name and a password - and everything that login holds. The
-- oldest row is the owner's; the admin backup opens the same row.
create table if not exists public.cutter_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) >= 1 and length(name) <= 64),
  -- PBKDF2-SHA256, 100 000 rounds (cutter index.ts hashPassword).
  pass_salt text not null,
  pass_hash text not null,
  -- Wrong passwords in a row, and until when the login is locked for them.
  failed_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.cutter_spaces enable row level security;
revoke all on public.cutter_spaces from anon, authenticated;

-- What the phones sync: campaigns (angles, looks, posting setup) and the
-- picture bank, one row per item, per login. `updated_at` is the phone's
-- clock (ms), used to keep the newer copy; `server_at` is this server's, set
-- as the write commits (clock_timestamp), which the phones pull by.
create table if not exists public.cutter_items (
  space_id uuid not null references public.cutter_spaces(id) on delete cascade,
  kind text not null check (kind in ('campaign', 'bank')),
  id text not null,
  data jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_at timestamptz not null default clock_timestamp(),
  primary key (space_id, kind, id)
);
alter table public.cutter_items enable row level security;
revoke all on public.cutter_items from anon, authenticated;
create index if not exists cutter_items_since on public.cutter_items (space_id, server_at);

-- What went wrong on a phone (src/report.ts -> cutter `report`): the error,
-- the step, the version, the phone, the video's size and type. Never the
-- video. Insert-only through the function; read in the dashboard to fix
-- things; swept after two months by the posting function's tick.
create table if not exists public.cutter_errors (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  happened_at timestamptz,
  page text not null check (page in ('cut', 'campaign')),
  kind text not null check (kind in ('failed', 'retried', 'fallback', 'interrupted', 'lost-pick', 'empty-pick', 'check', 'crash')),
  phase text,
  message text not null check (char_length(message) <= 2000),
  version text,
  login text,
  device jsonb,
  video jsonb
);
alter table public.cutter_errors enable row level security;
revoke all on public.cutter_errors from anon, authenticated;
create index if not exists cutter_errors_received_at on public.cutter_errors (received_at desc);

-- The pictures and sounds of the bank, and the shared music bank's files,
-- by SHA-256: private, no policies - the function signs every upload and
-- download URL.
insert into storage.buckets (id, name, public)
values ('cutter-files', 'cutter-files', false)
on conflict (id) do nothing;

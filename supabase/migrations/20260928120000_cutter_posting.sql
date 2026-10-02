-- Posting finished videos to Postiz: who posts, what was sent, and where
-- notifications go. Like every cutter_* table, row level security is on and
-- there are no policies, so only the edge functions (service role) can read
-- or write any of it - see supabase/functions/postiz/index.ts.

-- One person's posting: identified by their Postiz key, within the shared
-- login. Ziad and his friend share campaigns but post to their own Postiz,
-- so accounts and times live here, not on the campaign.
create table public.cutter_profiles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.cutter_spaces(id) on delete cascade,
  -- SHA-256 of the Postiz key: pasting the same key again finds the same
  -- profile, after a reinstall or on a new phone.
  key_hash text not null,
  -- Their Postiz accounts as last listed: [{ id, name, platform, profile, picture, disabled }].
  accounts jsonb not null default '[]'::jsonb,
  accounts_at timestamptz,
  -- Per campaign: { campaigns: { [campaignId]: { accounts: [integrationId], times: ['18:00'] } } }.
  settings jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Toronto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, key_hash)
);
alter table public.cutter_profiles enable row level security;

-- The keys themselves, encrypted by the function, kept apart from the
-- settings so nothing that reads a profile ever carries them.
create table public.cutter_profile_secrets (
  profile_id uuid primary key references public.cutter_profiles(id) on delete cascade,
  postiz_key text not null,
  anthropic_key text,
  updated_at timestamptz not null default now()
);
alter table public.cutter_profile_secrets enable row level security;

-- One finished video on its way to Postiz, and what became of it.
create table public.cutter_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.cutter_profiles(id) on delete cascade,
  -- The phone's own id for the video: sending it twice makes one post.
  client_key text not null,
  campaign_id text not null,
  campaign_name text not null,
  -- The campaign's posting rules as they were when it was sent.
  rules jsonb not null default '{}'::jsonb,
  -- uploading -> writing -> waiting (for him) -> approved -> scheduled -> posted,
  -- or error (Postiz could not publish it), rejected, failed (could not be
  -- got ready; tried again by itself, and by Try again).
  status text not null default 'uploading'
    check (status in ('uploading', 'writing', 'waiting', 'approved', 'scheduled', 'posted', 'error', 'rejected', 'failed')),
  parts integer not null,
  size bigint not null,
  file_name text,
  transcript text,
  headline text,
  duration real,
  caption text,
  title text,
  -- 'YYYY-MM-DD HH:MM' in the profile's timezone: at most one post per
  -- campaign time. Null for a time he chose, or for "now".
  slot text,
  post_at timestamptz,
  accounts jsonb not null default '[]'::jsonb,
  media jsonb,
  postiz_ids jsonb,
  release_urls jsonb,
  -- Set just before asking Postiz to create the post, so a retry after a
  -- crash looks for it before creating it again.
  creating_at timestamptz,
  error text,
  attempts integer not null default 0,
  retry_at timestamptz,
  checked_at timestamptz,
  checks integer not null default 0,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, client_key)
);
alter table public.cutter_posts enable row level security;
create unique index cutter_posts_one_per_slot on public.cutter_posts (profile_id, campaign_id, slot)
  where slot is not null and status not in ('rejected', 'failed');
create index cutter_posts_profile_recent on public.cutter_posts (profile_id, created_at desc);
create index cutter_posts_due on public.cutter_posts (status, post_at);

-- Where to send "posts to approve" and "submit it now".
create table public.cutter_push (
  endpoint text primary key,
  profile_id uuid not null references public.cutter_profiles(id) on delete cascade,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cutter_push enable row level security;

-- Server-side settings: the push keys and the scheduler's secret.
create table public.cutter_config (
  key text primary key,
  value text not null
);
alter table public.cutter_config enable row level security;

-- The videos on their way to Postiz, in parts, deleted once Postiz has them.
-- Private: only signed upload URLs made by the function reach it.
insert into storage.buckets (id, name, public)
values ('postiz-outbox', 'postiz-outbox', false)
on conflict (id) do nothing;

-- Held while one run of the function is moving a post along, so the phone's
-- "sent" and the scheduler never work on the same post at once.
alter table public.cutter_posts add column working_at timestamptz;

-- "Posts to approve" goes out at most every few minutes: a day's videos
-- finish one after another, and each one buzzing the phone is noise.
alter table public.cutter_profiles add column push_pending boolean not null default false;
alter table public.cutter_profiles add column pushed_at timestamptz;

-- A pretend Postiz, for testing the posting end to end without touching a
-- real account: a profile whose Postiz key starts "test-fake-postiz:" talks
-- to this table instead (supabase/functions/postiz/fake.ts).
create table public.cutter_fake_postiz (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  kind text not null check (kind in ('media', 'post')),
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cutter_fake_postiz enable row level security;
create index cutter_fake_postiz_owner on public.cutter_fake_postiz (owner, kind);

-- The posting scheduler: every five minutes the postiz function tries
-- again whatever is due, asks Postiz how the due posts went, and sends
-- reminders. It proves itself with a secret kept in cutter_config (set
-- once, by hand, with the push keys - never in this file).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cutter-posting-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/postiz',
    headers := jsonb_build_object('content-type', 'application/json'),
    body := jsonb_build_object('action', 'tick', 'secret', (select value from public.cutter_config where key = 'tick_secret')),
    timeout_milliseconds := 30000
  );
  $$
);

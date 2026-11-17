// Every payout is one row. A student's total is the sum of their approved rows,
// so there is no running number that can drift out of step with the history.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

export type PayoutStatus = 'reading' | 'pending' | 'approved' | 'rejected'
/** 'payout' counts towards the day it was approved; 'adjustment' only fixes a total. */
export type PayoutKind = 'payout' | 'adjustment'

export interface Payout {
  id: number
  guildId: string
  userId: string
  messageId: string | null
  channelId: string | null
  status: PayoutStatus
  kind: PayoutKind
  amountCents: number | null
  readCents: number | null
  readCurrency: string | null
  readNote: string | null
  cardChannelId: string | null
  cardMessageId: string | null
  replyMessageId: string | null
  decidedBy: string | null
}

export interface BoardRow {
  userId: string
  cents: number
}

const SCHEMA = `
create table if not exists payouts (
  id bigserial primary key,
  guild_id text not null,
  user_id text not null,
  message_id text unique,
  channel_id text,
  status text not null check (status in ('reading', 'pending', 'approved', 'rejected')),
  kind text not null default 'payout' check (kind in ('payout', 'adjustment')),
  amount_cents bigint,
  read_cents bigint,
  read_currency text,
  read_note text,
  card_channel_id text,
  card_message_id text,
  reply_message_id text,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
create index if not exists payouts_by_user on payouts (guild_id, user_id) where status = 'approved';
create index if not exists payouts_by_day on payouts (guild_id, decided_at) where status = 'approved';
create table if not exists bot_state (
  key text primary key,
  value text not null
);
`

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.query(statement)
  }
}

// pg hands bigint and sums back as strings; everything here is far below 2^53.
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value)
}

function toPayout(row: Record<string, unknown>): Payout {
  return {
    id: num(row.id),
    guildId: row.guild_id as string,
    userId: row.user_id as string,
    messageId: (row.message_id as string | null) ?? null,
    channelId: (row.channel_id as string | null) ?? null,
    status: row.status as PayoutStatus,
    kind: row.kind as PayoutKind,
    amountCents: numOrNull(row.amount_cents),
    readCents: numOrNull(row.read_cents),
    readCurrency: (row.read_currency as string | null) ?? null,
    readNote: (row.read_note as string | null) ?? null,
    cardChannelId: (row.card_channel_id as string | null) ?? null,
    cardMessageId: (row.card_message_id as string | null) ?? null,
    replyMessageId: (row.reply_message_id as string | null) ?? null,
    decidedBy: (row.decided_by as string | null) ?? null,
  }
}

/**
 * Takes ownership of a screenshot message so it is handled exactly once, even if
 * two copies of the bot are briefly running during a deploy. A message stuck in
 * 'reading' (the bot stopped half way) can be taken again after two minutes.
 * Returns the payout id, or null if the message is already handled.
 */
export async function claimMessage(
  db: Db,
  m: { guildId: string; userId: string; messageId: string; channelId: string },
): Promise<number | null> {
  const rows = await db.query<{ id: unknown }>(
    `insert into payouts (guild_id, user_id, message_id, channel_id, status)
     values ($1, $2, $3, $4, 'reading')
     on conflict (message_id) do update set claimed_at = now()
       where payouts.status = 'reading' and payouts.claimed_at < now() - interval '2 minutes'
     returning id`,
    [m.guildId, m.userId, m.messageId, m.channelId],
  )
  return rows.length ? num(rows[0].id) : null
}

/** Records what the screenshot reader found and where the approval card went. */
export async function markPending(
  db: Db,
  id: number,
  r: {
    readCents: number | null
    readCurrency: string | null
    readNote: string
    cardChannelId: string
    cardMessageId: string
  },
): Promise<void> {
  await db.query(
    `update payouts set status = 'pending', read_cents = $2, read_currency = $3, read_note = $4,
       card_channel_id = $5, card_message_id = $6
     where id = $1`,
    [id, r.readCents, r.readCurrency, r.readNote, r.cardChannelId, r.cardMessageId],
  )
}

export async function setReply(db: Db, id: number, replyMessageId: string): Promise<void> {
  await db.query(`update payouts set reply_message_id = $2 where id = $1`, [id, replyMessageId])
}

export async function getPayout(db: Db, id: number): Promise<Payout | null> {
  const rows = await db.query(`select * from payouts where id = $1`, [id])
  return rows.length ? toPayout(rows[0]) : null
}

/**
 * Approves a pending payout at the given amount. Returns null if it was already
 * decided, so two mods pressing at once cannot count it twice.
 */
export async function approve(db: Db, id: number, cents: number, by: string): Promise<Payout | null> {
  const rows = await db.query(
    `update payouts set status = 'approved', amount_cents = $2, decided_at = now(), decided_by = $3
     where id = $1 and status = 'pending'
     returning *`,
    [id, cents, by],
  )
  return rows.length ? toPayout(rows[0]) : null
}

export async function reject(db: Db, id: number, by: string): Promise<Payout | null> {
  const rows = await db.query(
    `update payouts set status = 'rejected', decided_at = now(), decided_by = $2
     where id = $1 and status = 'pending'
     returning *`,
    [id, by],
  )
  return rows.length ? toPayout(rows[0]) : null
}

/** A payout or correction a mod enters by hand; it counts straight away. */
export async function addApproved(
  db: Db,
  e: { guildId: string; userId: string; cents: number; kind: PayoutKind; by: string; note?: string },
): Promise<void> {
  await db.query(
    `insert into payouts (guild_id, user_id, status, kind, amount_cents, read_note, decided_at, decided_by)
     values ($1, $2, 'approved', $3, $4, $5, now(), $6)`,
    [e.guildId, e.userId, e.kind, e.cents, e.note ?? null, e.by],
  )
}

export async function totalFor(db: Db, guildId: string, userId: string): Promise<number> {
  const rows = await db.query<{ cents: unknown }>(
    `select coalesce(sum(amount_cents), 0) as cents from payouts
     where guild_id = $1 and user_id = $2 and status = 'approved'`,
    [guildId, userId],
  )
  return num(rows[0].cents)
}

/** Whether a student has anything on record, approved or not. */
export async function hasHistory(db: Db, guildId: string, userId: string): Promise<boolean> {
  const rows = await db.query(`select 1 from payouts where guild_id = $1 and user_id = $2 limit 1`, [
    guildId,
    userId,
  ])
  return rows.length > 0
}

/** Everyone's all-time total, highest first. */
export async function allTimeBoard(db: Db, guildId: string, limit: number): Promise<BoardRow[]> {
  const rows = await db.query<{ user_id: string; cents: unknown }>(
    `select user_id, sum(amount_cents) as cents from payouts
     where guild_id = $1 and status = 'approved'
     group by user_id
     having sum(amount_cents) > 0
     order by sum(amount_cents) desc, max(decided_at) asc
     limit $2`,
    [guildId, limit],
  )
  return rows.map((r) => ({ userId: r.user_id, cents: num(r.cents) }))
}

/**
 * What each student made on one day: payouts approved between that day's
 * midnights in the given time zone. Corrections made with /payouts set do not count.
 */
export async function dayBoard(
  db: Db,
  guildId: string,
  day: string,
  timeZone: string,
  limit: number,
): Promise<BoardRow[]> {
  const rows = await db.query<{ user_id: string; cents: unknown }>(
    `select user_id, sum(amount_cents) as cents from payouts
     where guild_id = $1 and status = 'approved' and kind = 'payout'
       and decided_at >= ($2::date)::timestamp at time zone $3
       and decided_at < ($2::date + 1)::timestamp at time zone $3
     group by user_id
     having sum(amount_cents) > 0
     order by sum(amount_cents) desc, max(decided_at) asc
     limit $4`,
    [guildId, day, timeZone, limit],
  )
  return rows.map((r) => ({ userId: r.user_id, cents: num(r.cents) }))
}

export async function getState(db: Db, key: string): Promise<string | null> {
  const rows = await db.query<{ value: string }>(`select value from bot_state where key = $1`, [key])
  return rows.length ? rows[0].value : null
}

export async function setState(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    `insert into bot_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  )
}

/** Sets a value only if it has never been set. Returns the value now stored. */
export async function initState(db: Db, key: string, value: string): Promise<string> {
  await db.query(`insert into bot_state (key, value) values ($1, $2) on conflict (key) do nothing`, [
    key,
    value,
  ])
  return (await getState(db, key)) ?? value
}

/**
 * Moves a day marker forward, but only if it is behind. Returns true for the one
 * caller that moved it - that caller posts the day's leaderboard.
 */
export async function advanceDay(db: Db, key: string, day: string): Promise<boolean> {
  const rows = await db.query(
    `update bot_state set value = $2 where key = $1 and value < $2 returning key`,
    [key, day],
  )
  return rows.length > 0
}

# Payout Bot

A Discord bot for a coaching server. Students post a screenshot of a payout,
a mod approves it, and the student's name becomes their running total:

> **Ziad | $300** → posts a $500 payout → **Ziad | $800**

Every night at midnight (New York time) it posts two top-10 leaderboards: the
day's top earners, and the all-time totals.

## How it works

1. A student posts a payout screenshot in **#payouts**. The bot reacts 👀,
   reads the amount off the screenshot, and replies *"Got it — I read $500.
   A mod will confirm it shortly."*
2. A card appears for the mods (in **#payout-approvals** if you set one up)
   with the screenshot and three buttons:
   - **Approve $500**: counts it as read.
   - **Change amount**: type the right number, then it counts.
   - **Reject**: nothing counts.
3. On approval the bot adds it to the student's total, renames them
   (`Ziad | $800`), reacts ✅, and edits its reply: *"+$500 added — you're
   now at $800!"*
4. At midnight it posts both leaderboards in **#leaderboard**:

   ```
   🏆 Top earners — Tuesday, Nov 17        💰 All-time leaderboard
   🥇 Ziad — $1,200                        🥇 Sam — $9,400  (+$300 today)
   🥈 Sam — $300                           🥈 Ziad — $4,800  (+$1,200 today)
   🥉 ...                                  🥉 ...
   ```

Nothing counts until a mod approves it. If the screenshot isn't in dollars,
or the bot can't find an amount, the Approve button is greyed out and the mod
types the dollar amount with **Change amount**.

Names stay honest: if anyone edits the `| $800` part of their name, the bot
puts the real total back within seconds. To fix a total, use `/payouts set`.
Renaming someone by hand won't work, because the bot will change it back.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/leaderboard` | everyone | Shows today's top 10 so far and the all-time top 10 (only to them). |
| `/payouts add` | mods | Adds a payout by hand, e.g. one sent in DMs. Counts for today. |
| `/payouts set` | mods | Corrects someone's all-time total. Doesn't count for today. |
| `/payouts import` | mods | One-time start: reads amounts already in nicknames (`Name \| $300`) and makes them the starting totals. |
| `/payouts post` | mods | Posts the leaderboard so far in the leaderboard channel right now. |

Mods are anyone with **Manage Nicknames** or **Manage Server**, plus anyone
with the role in `MOD_ROLE_ID` if you set it.

## Setting it up (about 20 minutes, once)

### 1. Create the bot in Discord

1. Go to <https://discord.com/developers/applications> → **New Application**.
   Name it (e.g. "Payout Bot").
2. Open **Bot** in the left menu:
   - Press **Reset Token** and copy the token. This is your `DISCORD_TOKEN`.
     Keep it secret.
   - Under **Privileged Gateway Intents**, turn on **Server Members Intent**
     and **Message Content Intent**, then save. Without these the bot can't
     see screenshots or rename anyone.
3. Open **OAuth2** → **URL Generator**:
   - Scopes: tick `bot` and `applications.commands`.
   - Bot permissions: tick **Manage Nicknames**, **View Channels**, **Send
     Messages**, **Embed Links**, **Add Reactions**, **Read Message History**.
   - Open the generated link and add the bot to your server.

### 2. Set up your server

1. Make the channels:
   - **#payouts**: students post screenshots here (replaces #wins).
   - **#payout-approvals**: only mods can see it. Recommended, so the
     Approve buttons aren't public. If you skip it, the cards appear in
     #payouts and only mods can press the buttons.
   - **#leaderboard**: students can read but not write.
2. **Server Settings → Roles**: drag the bot's role **above** your students'
   roles. Discord only lets a bot rename people whose roles are below its own.
   It can never rename the server owner, so the owner's name won't change.
3. Turn on **User Settings → Advanced → Developer Mode**, then right-click to
   copy IDs: the server icon → **Copy Server ID** (`GUILD_ID`), and each
   channel → **Copy Channel ID**.

### 3. Get an Anthropic API key

This is how the bot reads amounts off screenshots. Create a key at
<https://console.anthropic.com> → **API Keys**. Each screenshot costs about
1–2 cents. Without a key the bot still works, but mods type every amount.

### 4. Run it on Railway

The bot has to stay online all day to see new posts, so it needs a host.
[Railway](https://railway.com) is the easiest (about $5/month on the Hobby plan, which covers
the bot and its database).

1. **New Project → Deploy from GitHub repo** → pick this repository.
2. Open the new service → **Settings**:
   - **Root Directory**: `payout-bot`
   - **Branch**: the branch this bot is on (or `main` once it's merged).
3. Add a database to the project: **+ New → Database → PostgreSQL**.
4. Back on the bot service → **Variables**, add:

   | Variable | Value |
   |---|---|
   | `DISCORD_TOKEN` | the bot token from step 1 |
   | `GUILD_ID` | your server ID |
   | `PAYOUT_CHANNEL_ID` | #payouts channel ID |
   | `APPROVAL_CHANNEL_ID` | #payout-approvals channel ID (optional) |
   | `LEADERBOARD_CHANNEL_ID` | #leaderboard channel ID (optional, defaults to #payouts) |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills it in) |
   | `MOD_ROLE_ID` | optional: a role that can approve payouts |
   | `TIME_ZONE` | optional: defaults to `America/New_York` |

5. Deploy. The logs should say `Logged in as Payout Bot#1234` and
   `Watching for payouts.` The bot creates its own database tables.
6. In Discord, run `/payouts post` to check the leaderboard channel works, and
   post a test screenshot in #payouts.

If your students already have amounts in their names, run `/payouts import`
once to start from those.

**Already use Supabase?** You can use it instead of Railway's database: set
`DATABASE_URL` to the **Session pooler** connection string from Supabase →
Connect. If your database password has symbols in it, reset it to letters and
numbers first, so the link works.

## Good to know

- **Amounts are in US dollars.** A payout in another currency shows as
  e.g. "450 EUR". The mod enters the dollar value with **Change amount**.
- **"Today" is the day a payout is approved**, in New York time. A screenshot
  posted at 11:55pm and approved at 12:05am counts on the new day's board.
- **If the bot was offline**, it picks up screenshots posted in #payouts
  during the last 3 days when it restarts. It ignores anything posted before
  it was first started.
- **Someone who leaves** drops off the leaderboard. If they come back, their
  total goes back on their name.
- **Screenshots only.** Videos and files aren't read.

## Developing

```bash
cd payout-bot
npm install
npm test        # runs against a Postgres that lives in memory
npm run check   # type-check
npm start       # needs the variables above, e.g. in your shell
```

The code runs straight from TypeScript (Node 22.18 or newer), so there's no
build step.

- `src/bot.ts`: Discord events, buttons, commands and the midnight post.
- `src/db.ts`: payouts and totals. Every payout is a row, and a total is
  the sum of approved rows.
- `src/reader.ts`: reads the amount off a screenshot with Claude.
- `src/card.ts`, `src/board.ts`: the approval card and the leaderboards.
- `src/nickname.ts`, `src/money.ts`, `src/day.ts`: names, amounts and days.

#!/usr/bin/env bash
# Ships the server functions (posting and the shared login):  ./deploy-server.sh
# ./deploy.sh runs this by itself whenever the server code changed.
#
# It needs a Supabase access token - never the Mac's keychain. Make one at
# https://supabase.com/dashboard/account/tokens ("Generate new token") and
# paste it when asked; say yes to keep it in ~/.supabase-token (only your Mac
# user can read it, and it is never in the repo), and it won't ask again.
set -euo pipefail

PROJECT=uykuoibqdxmpbbrsmyad
TOKEN_FILE="$HOME/.supabase-token"
red() { printf '\n\033[1;31m%s\033[0m\n' "$1"; }

trap 'red "THE SERVER WAS NOT UPDATED - the step above failed. Read the error just above this line."; [ -s "$TOKEN_FILE" ] && echo "If it says the token is invalid or expired: rm ~/.supabase-token and run ./deploy-server.sh again with a new one."' ERR

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -s "$TOKEN_FILE" ]; then
  SUPABASE_ACCESS_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
fi
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "The server deploy needs a Supabase token: https://supabase.com/dashboard/account/tokens -> Generate new token."
  read -r -s -p "Paste it here (nothing shows while you paste), then press Enter: " SUPABASE_ACCESS_TOKEN
  echo
  SUPABASE_ACCESS_TOKEN=$(printf '%s' "$SUPABASE_ACCESS_TOKEN" | tr -d '[:space:]')
  if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    red "THE SERVER WAS NOT UPDATED - no token was pasted."
    exit 1
  fi
  read -r -p "Keep it on this Mac so it never asks again? [y/N] " keep
  if [ "$keep" = y ] || [ "$keep" = Y ]; then
    (umask 077 && printf '%s\n' "$SUPABASE_ACCESS_TOKEN" > "$TOKEN_FILE")
    echo "Kept in ~/.supabase-token."
  fi
fi
export SUPABASE_ACCESS_TOKEN

# Both check the cutter's own login themselves, so Supabase's JWT check stays
# off (ARCHITECTURE.md). The repo's copies are the source of record (AGENTS.md).
echo "1/2  Deploying the posting function"
npx supabase functions deploy postiz --project-ref "$PROJECT" --no-verify-jwt
echo "2/2  Deploying the login and sync function"
npx supabase functions deploy cutter --project-ref "$PROJECT" --no-verify-jwt

git rev-parse HEAD > .last-server-deploy
printf '\n\033[1;32m%s\033[0m\n' "Server updated."

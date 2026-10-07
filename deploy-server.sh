#!/usr/bin/env bash
# Ships the server functions (posting and the shared login), only when
# ./deploy.sh says the server code changed:  ./deploy-server.sh
#
# This one needs a Supabase login. If your Mac asks for a "keychain" password,
# that is your Mac's own login password - type it and press "Always Allow", and
# it won't ask again. To skip the keychain altogether, make a token at
# https://supabase.com/dashboard/account/tokens and run it as
#   SUPABASE_ACCESS_TOKEN=paste-it-here ./deploy-server.sh
set -euo pipefail

PROJECT=uykuoibqdxmpbbrsmyad

# Both check the cutter's own login themselves, so Supabase's JWT check stays
# off (ARCHITECTURE.md). The repo's copies are the source of record (AGENTS.md).
echo "1/2  Deploying the posting function"
npx supabase functions deploy postiz --project-ref "$PROJECT" --no-verify-jwt
echo "2/2  Deploying the login and sync function"
npx supabase functions deploy cutter --project-ref "$PROJECT" --no-verify-jwt

git rev-parse HEAD > .last-server-deploy
echo "Done."

#!/usr/bin/env bash
# One command to ship the cutter from your Mac:  ./deploy.sh
# Needs: `npx supabase login` done once, and a Netlify login (it asks if not).
set -euo pipefail

PROJECT=uykuoibqdxmpbbrsmyad
BRANCH=claude/cutter-lockdown-and-map

echo "1/4  Getting the latest code ($BRANCH)"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "2/4  Turning the planner bridge on for both your planner accounts"
npx supabase secrets set \
  CUTTER_BRIDGE_USER_IDS=00cf1d16-ffb1-4bb8-b3d8-2882f52e8c9c,0cd83d67-c455-46bf-8fa8-8075fa5148c1 \
  --project-ref "$PROJECT"

echo "3/4  Deploying the posting function"
npx supabase functions deploy postiz --project-ref "$PROJECT"

echo "4/4  Deploying the cutter app"
npm ci --ignore-scripts
npx netlify deploy --build --prod

echo "Done. Open the cutter and try a wrong password: it should say 'Wrong login or password.'"

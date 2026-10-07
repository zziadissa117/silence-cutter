#!/usr/bin/env bash
# One command to ship the cutter app from your Mac:  ./deploy.sh
# Needs only a Netlify login (it asks the first time, in the browser).
# No Supabase login and no keychain: the server functions rarely change, and
# when they do this says so at the end - then run ./deploy-server.sh too.
set -euo pipefail

BRANCH=claude/cutter-lockdown-and-map
SERVER_MARK=.last-server-deploy

echo "1/2  Getting the latest code ($BRANCH)"
git fetch origin
git checkout "$BRANCH"
before=$(git rev-parse HEAD)
git pull origin "$BRANCH"

echo "2/2  Deploying the cutter app"
npm ci --ignore-scripts
npx netlify deploy --prod

# The server code, compared with the last time ./deploy-server.sh ran (or, if
# it never has on this Mac, with what was here before this update).
since=$( [ -s "$SERVER_MARK" ] && cat "$SERVER_MARK" || echo "$before" )
if git cat-file -e "$since^{commit}" 2>/dev/null && ! git diff --quiet "$since" HEAD -- supabase/functions; then
  echo
  echo "Done - and the server code changed too. Run:  ./deploy-server.sh"
else
  echo "Done. Open the cutter and reload it to get the new version."
fi

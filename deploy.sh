#!/usr/bin/env bash
# One command to ship the cutter app from your Mac:  ./deploy.sh
# Needs a Netlify login (it asks the first time, in the browser). When the
# server code changed too, it runs ./deploy-server.sh as well, which asks for
# a Supabase token once (see that file) - and says in red if that fails.
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
  echo "3/3  The server code changed too - updating the server"
  if ! ./deploy-server.sh; then
    printf '\n\033[1;31m%s\033[0m\n' "The app is live, but THE SERVER WAS NOT UPDATED - its new features will keep saying to run ./deploy-server.sh."
    echo "Fix what the error above says, then run:  ./deploy-server.sh"
    exit 1
  fi
  echo "Done - app and server both updated. Close the cutter and open it again."
else
  echo "Done. Open the cutter and reload it to get the new version."
fi

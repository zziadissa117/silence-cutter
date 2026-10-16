"""Settings, all from the environment (Railway's Variables). Secrets never go in the repo.

ENGINE_DATA        where footage, songs and history live (a Railway volume, /data)
CUTTER_URL         the Cutter's login function (checks a phone's login token)
POSTIZ_FN_URL      the Cutter's posting function (videos are sent through it, like the phone's)
PUBLISHABLE_KEY    the Supabase project's public key (public by design; the functions check the login)
ALLOWED_ORIGIN     the app's address, the only page allowed to call the engine
ANTHROPIC_API_KEY  optional: Claude rewords his hooks a little for each video
PORT               set by Railway
"""

import os

PROJECT = "https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1"

CUTTER_URL = os.environ.get("CUTTER_URL", f"{PROJECT}/cutter")
POSTIZ_FN_URL = os.environ.get("POSTIZ_FN_URL", f"{PROJECT}/postiz")
PUBLISHABLE_KEY = os.environ.get("PUBLISHABLE_KEY", "sb_publishable_UhAfC6SJRmnDOR5Y10CmPg_DFepNyVA")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://silence-cutter.netlify.app")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
PORT = int(os.environ.get("PORT", "8080"))

# Instagram takes nothing bigger; the renders stay well under it.
MAX_UPLOAD_BYTES = 2 * 1024 ** 3
PART_BYTES = 8 * 1024 * 1024

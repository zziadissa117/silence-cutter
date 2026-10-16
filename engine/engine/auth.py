"""Who is calling: the Cutter's own login token, checked by the Cutter's login function.

The engine has no logins of its own. A phone signed in to the Cutter sends its
token; the login function says which shared space it belongs to (or that it is
no good). Answers are kept a few minutes so a burst of upload parts is not a
burst of checks.
"""

import json
import threading
import time
import urllib.error
import urllib.request

from . import config

_KEEP_SEC = 300
_cache: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()


def _ask(token: str) -> str | None:
    body = json.dumps({"action": "whoami", "token": token}).encode()
    req = urllib.request.Request(
        config.CUTTER_URL,
        data=body,
        method="POST",
        headers={"content-type": "application/json", "apikey": config.PUBLISHABLE_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        if err.code in (401, 403):
            return None
        raise
    space = data.get("space")
    return space if isinstance(space, str) and space else None


def space_for(token: str | None, ask=_ask) -> str | None:
    """The shared space a login token belongs to, or None when it is not a valid login."""
    if not token or len(token) > 2000:
        return None
    now = time.time()
    with _lock:
        hit = _cache.get(token)
        if hit and now - hit[0] < _KEEP_SEC:
            return hit[1]
    space = ask(token)
    if space:
        with _lock:
            _cache[token] = (now, space)
    return space

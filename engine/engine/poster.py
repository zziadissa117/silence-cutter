"""Sends a finished video the way the phone does (src/campaign/outbox.ts): to
the Cutter's posting function, which keeps it, has Claude write its caption,
gives it its batch's day and time, and waits for his approval in Posts - so
the engine's videos are in the same Posts screen as everything else, with the
same limits, retries and one-post-per-key.

start -> each missing piece to its signed upload address -> sent.
"""

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import config


class PostingError(Exception):
    pass


def _call(action: str, token: str, body: dict, url: str | None = None) -> dict:
    data = json.dumps({"action": action, "token": token, **body}).encode()
    req = urllib.request.Request(
        url or config.POSTIZ_FN_URL,
        data=data,
        method="POST",
        headers={"content-type": "application/json", "apikey": config.PUBLISHABLE_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        try:
            said = json.loads(err.read() or b"{}").get("error")
        except ValueError:
            said = None
        raise PostingError(said or f"The posting server said {err.code}.") from err


def _put_part(url: str, piece: bytes) -> None:
    """One piece, as the phone sends it: a form with the bytes under an empty name."""
    boundary = f"----engine{uuid.uuid4().hex}"
    head = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"cacheControl\"\r\n\r\n3600\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"\"; filename=\"blob\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url,
        data=head + piece + tail,
        method="PUT",
        headers={
            "content-type": f"multipart/form-data; boundary={boundary}",
            "apikey": config.PUBLISHABLE_KEY,
            "x-upsert": "true",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        if res.status >= 300:
            raise PostingError(f"A piece of the video could not be sent ({res.status}).")


def send(video: Path, *, token: str, profile: str, key: str, campaign: dict, meta: dict,
         call=_call, put=_put_part, tries: int = 3) -> str:
    """Sends one finished video. Returns its post's id. Safe to call again with the same key."""
    size = video.stat().st_size
    for _round in range(3):
        started = call("start", token, {"profile": profile, "key": key, "size": size, "campaign": campaign, "meta": meta})
        if started.get("status") != "uploading":
            return started["id"]
        part_bytes = int(started["partBytes"])
        with open(video, "rb") as f:
            for upload in started.get("uploads", []):
                f.seek(upload["part"] * part_bytes)
                piece = f.read(part_bytes)
                for attempt in range(1, tries + 1):
                    try:
                        put(upload["url"], piece)
                        break
                    except Exception:  # noqa: BLE001 - tried again, then said
                        if attempt >= tries:
                            raise
                        time.sleep(attempt * 2)
        done = call("sent", token, {"profile": profile, "key": key})
        if not done.get("missing"):
            return done["id"]
    raise PostingError("Part of the video did not arrive.")

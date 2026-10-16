"""Batches being made, one at a time, in the background.

A batch is the phone's: how many videos, each one's day and time, the
campaign's posting rules. For each: Le plateau makes a video (remixer), the
guard checks it is not a near-copy (made again, at most three times, if it
is), and it is sent through the Cutter's posting pipeline to wait for his
approval in Posts. What was sent is let go here - Postiz has it.

The phone's login token is kept in memory only: if the engine restarts in the
middle, the batch says it stopped, and Carry on (again()) on the phone carries
on where it was (each video's key is the same, so nothing goes twice).
"""

import json
import os
import queue
import subprocess
import threading
import time
import uuid
from pathlib import Path

from .plateau_paths import DATA  # first: puts Le plateau's files where Python finds them

import remixer  # noqa: E402

from . import guard, hooks, poster, series  # noqa: E402

JOBS = DATA / "jobs"
TRIES = 3

_queue: "queue.Queue[str]" = queue.Queue()
_tokens: dict[str, str] = {}
_lock = threading.Lock()
_worker: threading.Thread | None = None


def _path(job_id: str) -> Path:
    return JOBS / f"{job_id}.json"


def load(job_id: str) -> dict | None:
    if not (len(job_id) == 32 and all(c in "0123456789abcdef" for c in job_id)):
        return None
    try:
        return json.loads(_path(job_id).read_text())
    except (OSError, ValueError):
        return None


def _save(job: dict) -> None:
    JOBS.mkdir(parents=True, exist_ok=True)
    tmp = JOBS / f".{job['id']}-{uuid.uuid4().hex}.json"
    tmp.write_text(json.dumps(job))
    os.replace(tmp, _path(job["id"]))


def _update(job_id: str, **fields) -> dict:
    with _lock:
        job = load(job_id) or {}
        job.update(fields)
        _save(job)
        return job


def list_jobs(space: str, limit: int = 20) -> list[dict]:
    if not JOBS.is_dir():
        return []
    found = []
    for p in JOBS.glob("*.json"):
        try:
            j = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if j.get("space") == space:
            found.append({k: v for k, v in j.items() if k not in ("space", "slots", "campaignInfo")})
    return sorted(found, key=lambda j: j.get("at", 0), reverse=True)[:limit]


def clean_request(data: dict) -> dict:
    campaign = data.get("campaign") or {}
    if not isinstance(campaign, dict) or not isinstance(campaign.get("id"), str):
        raise ValueError("Which campaign?")
    series.safe_id(campaign["id"])
    if not isinstance(data.get("profile"), str) or len(data["profile"]) > 64:
        raise ValueError("Posting is not set up on this phone.")
    batch_id = data.get("batchId")
    if not isinstance(batch_id, str) or not batch_id or len(batch_id) > 64:
        raise ValueError("Which batch?")
    slots = data.get("slots")
    if not isinstance(slots, list) or not slots or len(slots) > 500:
        raise ValueError("How many videos?")
    clean_slots = []
    for s in slots:
        if not (isinstance(s, dict) and isinstance(s.get("date"), str) and isinstance(s.get("time"), str)):
            raise ValueError("Each video needs its day and time.")
        clean_slots.append({"date": s["date"][:10], "time": s["time"][:5]})
    return {
        "campaignInfo": {"id": campaign["id"], "name": str(campaign.get("name", ""))[:200], "posting": campaign.get("posting") or {}},
        "profile": data["profile"],
        "batchId": batch_id,
        "slots": clean_slots,
    }


def submit(data: dict, token: str, space: str) -> dict:
    request = clean_request(data)
    clips = series.files(request["campaignInfo"]["id"])
    if not clips["hook"] or not clips["product"]:
        raise ValueError("Add at least one hook and one product clip first.")
    job_id = uuid.uuid4().hex
    # The same batch made again (after a stop): what already went is not made twice.
    already = set()
    for earlier in list_jobs(space, limit=200):
        if earlier.get("batchId") == request["batchId"] and earlier.get("campaign") == request["campaignInfo"]["id"]:
            already.update(earlier.get("done", []))
    job = {
        "id": job_id, "space": space, "at": time.time(), "status": "waiting",
        "campaign": request["campaignInfo"]["id"], "batchId": request["batchId"],
        "total": len(request["slots"]), "sent": len(already), "rejected": 0, "skipped": 0, "done": sorted(already),
        **request,
    }
    _save(job)
    with _lock:
        _tokens[job_id] = token
    _queue.put(job_id)
    start_worker()
    return {k: v for k, v in job.items() if k not in ("space", "slots", "campaignInfo")}


def again(job_id: str, token: str, space: str) -> dict:
    """A stopped batch carried on: same videos, same keys, what already went is skipped."""
    job = load(job_id)
    if not job or job.get("space") != space:
        raise LookupError("No such batch.")
    if job.get("status") in ("waiting", "making"):
        return {k: v for k, v in job.items() if k not in ("space", "slots", "campaignInfo")}
    return submit({"campaign": job["campaignInfo"], "profile": job["profile"], "batchId": job["batchId"],
                   "slots": job["slots"]}, token, space)


def stop(job_id: str, space: str) -> bool:
    job = load(job_id)
    if not job or job.get("space") != space:
        return False
    _update(job_id, stopRequested=True)
    return True


def _seconds(video: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                       capture_output=True, text=True, timeout=60)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def make_one(campaign_id: str, serie: dict, batch_prints: list) -> tuple[Path | None, list[int], str, int]:
    """One video that passes the guard: (its file or None, its fingerprint, its hook words, near-copies made)."""
    folder = series.folder(campaign_id)
    sid = series.safe_id(campaign_id)
    rejected = 0
    for _ in range(TRIES):
        said: list[str] = []
        roll = remixer.roll_variation

        def heard(*args, **kwargs):
            v = roll(*args, **kwargs)
            if v.get("caption"):
                said.append(v["caption"])
            return v

        remixer.roll_variation = heard
        try:
            made = remixer.generate(folder, serie, 1)
        finally:
            remixer.roll_variation = roll
        if not made:
            break
        path = series.output_dir(campaign_id) / made[0]
        prints = guard.fingerprint(path)
        ok, _worst, _what = guard.verdict(prints, sid, batch_prints)
        if ok:
            return path, prints, said[0] if said else "", rejected
        path.unlink(missing_ok=True)
        rejected += 1
    return None, [], "", rejected


def run(job_id: str, send=poster.send, reword=hooks.rewordings) -> None:
    job = load(job_id)
    if not job:
        return
    with _lock:
        token = _tokens.get(job_id)
    if not token:
        _update(job_id, status="stopped", error="The engine restarted - tap Carry on in Batch to make the rest.")
        return
    campaign_id = job["campaign"]
    sid = series.safe_id(campaign_id)
    _update(job_id, status="making", error=None)
    lines = reword(series.settings_of(campaign_id)["hooks"])
    serie = series.serie_for(campaign_id, lines)
    batch_prints: list = []
    done = set(job.get("done", []))
    try:
        for i, slot in enumerate(job["slots"]):
            if (load(job_id) or {}).get("stopRequested"):
                _update(job_id, status="stopped")
                return
            if i in done:
                continue
            path, prints, headline, rejected = make_one(campaign_id, serie, batch_prints)
            job = _update(job_id, rejected=job.get("rejected", 0) + rejected)
            if not path:
                job = _update(job_id, skipped=job.get("skipped", 0) + 1)
                continue
            key = f"engine-{job['batchId']}-{i}"
            meta = {
                "transcript": "",
                "headline": headline,
                "duration": _seconds(path),
                "fileName": path.name,
                "batch": {"id": job["batchId"], "date": slot["date"], "time": slot["time"], "size": job["total"]},
            }
            send(path, token=token, profile=job["profile"], key=key, campaign=job["campaignInfo"], meta=meta)
            guard.remember(prints, sid, key)
            batch_prints.append(prints)
            path.unlink(missing_ok=True)
            done.add(i)
            job = _update(job_id, sent=job.get("sent", 0) + 1, done=sorted(done))
        _update(job_id, status="done")
    except Exception as error:  # noqa: BLE001 - said on the phone, the batch can be made again
        _update(job_id, status="failed", error=str(error)[:500])
    finally:
        with _lock:
            _tokens.pop(job_id, None)


def _work() -> None:
    while True:
        job_id = _queue.get()
        try:
            run(job_id)
        finally:
            _queue.task_done()


def start_worker() -> None:
    global _worker
    with _lock:
        if _worker and _worker.is_alive():
            return
        _worker = threading.Thread(target=_work, name="engine-jobs", daemon=True)
        _worker.start()


def mark_interrupted() -> None:
    """On start: batches that were being made when the engine stopped say so."""
    if not JOBS.is_dir():
        return
    for p in JOBS.glob("*.json"):
        try:
            job = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if job.get("status") in ("waiting", "making"):
            job["status"] = "stopped"
            job["error"] = "The engine restarted - tap Carry on in Batch to make the rest."
            _save(job)

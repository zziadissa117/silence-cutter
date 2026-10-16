"""The engine's web address: what the Cutter on the phone calls.

Every route but /health needs the Cutter's login token (auth.py), and only
the app's own page may call it from a browser (ALLOWED_ORIGIN). Footage
arrives in pieces (uploads.py); batches are made in the background (jobs.py).

  GET    /health
  GET    /status                              series, songs, batches, disk
  GET    /series/<campaign>                   its settings and clips
  PUT    /series/<campaign>                   its settings
  DELETE /series/<campaign>/files/<kind>/<name>
  POST   /uploads                             {kind, campaign, name, size}
  PUT    /uploads/<id>/<part>                 the piece's bytes
  POST   /uploads/<id>/finish
  DELETE /songs/<name>
  POST   /make                                a batch (jobs.clean_request)
  GET    /jobs/<id>
  POST   /jobs/<id>/stop
  POST   /jobs/<id>/again                     a stopped batch carried on
"""

import json
import shutil
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .plateau_paths import DATA  # first: puts Le plateau's files where Python finds them

import sons  # noqa: E402

from . import auth, config, jobs, series, uploads  # noqa: E402

MAX_JSON = 1024 * 1024


class Problem(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "CutterEngine/1"
    space_check = staticmethod(auth.space_for)

    # --- plumbing ---------------------------------------------------------

    def log_message(self, fmt, *args):  # quieter: one line per request, no bodies
        print(f"{self.command} {self.path.split('?')[0]} {fmt % args}")

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin == config.ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")

    def _reply(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit: int) -> bytes:
        length = int(self.headers.get("content-length") or 0)
        if length < 0 or length > limit:
            raise Problem("Too big.", 413)
        return self.rfile.read(length) if length else b""

    def _json(self) -> dict:
        try:
            data = json.loads(self._body(MAX_JSON) or b"{}")
        except ValueError as err:
            raise Problem("Not JSON.") from err
        if not isinstance(data, dict):
            raise Problem("Not JSON.")
        return data

    def _space(self) -> tuple[str, str]:
        header = self.headers.get("authorization") or ""
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        space = self.space_check(token)
        if not space:
            raise Problem("signed-out", 401)
        return space, token

    def _route(self) -> list[str]:
        path = urllib.parse.urlparse(self.path).path
        return [urllib.parse.unquote(p) for p in path.strip("/").split("/") if p]

    def _handle(self, method: str) -> None:
        try:
            parts = self._route()
            if method == "GET" and parts == ["health"]:
                return self._reply(200, {"ok": True})
            space, token = self._space()
            self._reply(200, self._dispatch(method, parts, space, token))
        except Problem as err:
            self._reply(err.status, {"error": str(err)})
        except (ValueError, LookupError) as err:
            self._reply(400, {"error": str(err)})
        except Exception:  # noqa: BLE001 - logged, and said without details
            traceback.print_exc()
            self._reply(500, {"error": "The engine hit a problem. Try again."})

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_PUT(self):  # noqa: N802
        self._handle("PUT")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")

    # --- routes -----------------------------------------------------------

    def _dispatch(self, method: str, parts: list[str], space: str, token: str) -> dict:
        match (method, parts):
            case ("GET", ["status"]):
                return status(space)
            case ("GET", ["series", campaign]):
                return {"settings": series.settings_of(campaign), "files": series.files(campaign)}
            case ("PUT", ["series", campaign]):
                return {"settings": series.save_settings(campaign, self._json())}
            case ("DELETE", ["series", campaign, "files", kind, name]):
                return {"removed": series.remove_clip(campaign, kind, name)}
            case ("POST", ["uploads"]):
                data = self._json()
                if data.get("kind") != "song":
                    series.safe_id(str(data.get("campaign", "")))
                return uploads.start(str(data.get("kind")), str(data.get("campaign", "")), str(data.get("name", "")),
                                     data.get("size"), space)
            case ("PUT", ["uploads", upload_id, part]):
                if not part.isdigit():
                    raise Problem("No such piece.")
                return uploads.put(upload_id, int(part), self._body(config.PART_BYTES), space)
            case ("POST", ["uploads", upload_id, "finish"]):
                return finish_upload(upload_id, space)
            case ("DELETE", ["songs", name]):
                sons.supprimer(name)
                return {"removed": True}
            case ("POST", ["make"]):
                return {"job": jobs.submit(self._json(), token, space)}
            case ("GET", ["jobs", job_id]):
                job = jobs.load(job_id)
                if not job or job.get("space") != space:
                    raise Problem("No such batch.", 404)
                return {"job": {k: v for k, v in job.items() if k not in ("space", "slots", "campaignInfo")}}
            case ("POST", ["jobs", job_id, "stop"]):
                return {"stopped": jobs.stop(job_id, space)}
            case ("POST", ["jobs", job_id, "again"]):
                return {"job": jobs.again(job_id, token, space)}
        raise Problem("Not here.", 404)


def finish_upload(upload_id: str, space: str) -> dict:
    meta, path = uploads.finish(upload_id, space)
    try:
        if meta["kind"] == "song":
            if not uploads.probe(path, "audio"):
                raise ValueError(f"{meta['name']} has no sound in it.")
            return {"song": sons.importer(path, meta["name"])}
        if not uploads.probe(path, "video"):
            raise ValueError(f"{meta['name']} isn't a video this can read.")
        return {"clip": series.keep_clip(meta["campaign"], meta["kind"], path, meta["name"])}
    finally:
        uploads.forget(upload_id)


def status(space: str) -> dict:
    lib = sons.scanner()
    tracks = lib.get("tracks", {}) if isinstance(lib, dict) else {}
    usage = shutil.disk_usage(DATA)
    found = []
    for d in sorted(p for p in series.SERIES.iterdir() if p.is_dir()) if series.SERIES.is_dir() else []:
        found.append({"campaign": d.name, "settings": series.settings_of(d.name), "files": series.files(d.name)})
    return {
        "series": found,
        "songs": [{"name": n, "start": t.get("start", 0.0), "seconds": t.get("duration", 0.0)} for n, t in tracks.items()],
        "jobs": jobs.list_jobs(space),
        "disk": {"usedGB": round(usage.used / 1e9, 1), "freeGB": round(usage.free / 1e9, 1)},
        "claude": bool(config.ANTHROPIC_API_KEY),
    }


def main() -> None:
    uploads.sweep()
    jobs.mark_interrupted()
    jobs.start_worker()
    server = ThreadingHTTPServer(("0.0.0.0", config.PORT), Handler)
    print(f"Engine listening on {config.PORT}, data in {DATA}")
    server.serve_forever()


if __name__ == "__main__":
    main()

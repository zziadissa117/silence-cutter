"""The engine, end to end where it can be: real ffmpeg renders of tiny clips,
the guard, uploads in pieces, the web routes, and a batch sent to a stand-in
posting function. Run: cd engine && python -m unittest discover -s tests"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

DATA = Path(tempfile.mkdtemp(prefix="engine-test-"))
os.environ["ENGINE_DATA"] = str(DATA)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import config, guard, jobs, poster, series, uploads  # noqa: E402
from engine import server as web  # noqa: E402

# Batches are run by the tests themselves, never by the background worker.
jobs.start_worker = lambda: None

MEDIA = DATA / "_media"


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def setUpModule():
    MEDIA.mkdir(parents=True, exist_ok=True)
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30", "-f", "lavfi", "-i", "sine=frequency=300",
           "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(MEDIA / "hook.mp4"))
    ffmpeg("-f", "lavfi", "-i", "mandelbrot=size=540x960:rate=30", "-t", "6", "-c:v", "libx264",
           "-pix_fmt", "yuv420p", str(MEDIA / "product.mp4"))
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=40", "-c:a", "aac", str(MEDIA / "song.m4a"))


def tearDownModule():
    shutil.rmtree(DATA, ignore_errors=True)


class Guard(unittest.TestCase):
    def test_hash_and_similarity(self):
        flat = bytes([10] * 72)
        ramp = bytes(200 - c * 20 for r in range(8) for c in range(9))
        self.assertEqual(guard.dhash(flat), 0)
        self.assertNotEqual(guard.dhash(ramp), 0)
        self.assertEqual(guard.similarity([1, 2, 3], [1, 2, 3]), 1.0)
        self.assertEqual(guard.similarity([0], [(1 << 64) - 1]), 0.0)

    def test_thresholds(self):
        a = [0x0F0F0F0F0F0F0F0F] * 10
        far = [0xF0F0F0F0F0F0F0F0] * 10
        ok, _, _ = guard.verdict(a, "s1", [])
        self.assertTrue(ok)
        guard.remember(a, "s1", "k1")
        self.assertFalse(guard.verdict(a, "s1", [])[0], "a re-cut of the same campaign")
        self.assertFalse(guard.verdict(a, "s2", [])[0], "another campaign's clips")
        self.assertTrue(guard.verdict(far, "s1", [])[0])
        self.assertFalse(guard.verdict(far, "s1", [far])[0], "same as one already in the batch")


class Series(unittest.TestCase):
    def test_settings_are_checked(self):
        saved = series.save_settings("camp-1", {"hooks": [" POV: it works ", "", 5, "POV: it works"], "hookSec": [9, 2],
                                                "variation": False, "textPos": "nowhere"})
        self.assertEqual(saved["hooks"], ["POV: it works"])
        self.assertEqual(saved["hookSec"], [2.0, 9.0])
        self.assertFalse(saved["variation"])
        self.assertEqual(saved["textPos"], "haut")
        serie = series.serie_for("camp-1")
        self.assertEqual(serie["slots"][0]["captions"], ["POV: it works"])
        self.assertEqual(serie["settings"]["speed_max"], 1.0)
        with self.assertRaises(ValueError):
            series.safe_id("../..")


class Uploads(unittest.TestCase):
    def test_pieces_then_file(self):
        old = config.PART_BYTES
        config.PART_BYTES = 4
        try:
            started = uploads.start("hook", "camp-1", "x.mp4", 10, "space")
            self.assertEqual(started["parts"], 3)
            with self.assertRaises(ValueError):
                uploads.put(started["id"], 0, b"abc", "space")
            uploads.put(started["id"], 2, b"ij", "space")
            uploads.put(started["id"], 0, b"abcd", "space")
            with self.assertRaises(ValueError):
                uploads.finish(started["id"], "space")
            self.assertEqual(uploads.put(started["id"], 1, b"efgh", "space")["missing"], [])
            with self.assertRaises(LookupError):
                uploads.put(started["id"], 1, b"efgh", "another space")
            meta, path = uploads.finish(started["id"], "space")
            self.assertEqual(path.read_bytes(), b"abcdefghij")
            uploads.forget(started["id"])
        finally:
            config.PART_BYTES = old


class Poster(unittest.TestCase):
    def test_sends_like_the_phone(self):
        video = MEDIA / "product.mp4"
        calls, pieces = [], []

        def call(action, token, body, url=None):
            calls.append((action, body))
            if action == "start":
                return {"id": "post-1", "status": "uploading", "partBytes": 1024 * 1024,
                        "uploads": [{"part": i, "url": f"u{i}"} for i in range(-(-video.stat().st_size // (1024 * 1024)))]}
            return {"id": "post-1", "missing": []}

        post_id = poster.send(video, token="t", profile="p", key="k", campaign={"id": "c"}, meta={},
                              call=call, put=lambda url, piece: pieces.append(len(piece)))
        self.assertEqual(post_id, "post-1")
        self.assertEqual([c[0] for c in calls], ["start", "sent"])
        self.assertEqual(sum(pieces), video.stat().st_size)

    def test_already_sent_is_not_sent_again(self):
        calls = []
        post_id = poster.send(MEDIA / "product.mp4", token="t", profile="p", key="k", campaign={}, meta={},
                              call=lambda a, t, b, url=None: calls.append(a) or {"id": "post-2", "status": "waiting"})
        self.assertEqual((post_id, calls), ("post-2", ["start"]))


class Batch(unittest.TestCase):
    """Le plateau's real render, the guard, and the send, for a batch of two."""

    def test_makes_and_sends_a_batch(self):
        cid = "camp-batch"
        for kind in ("hook", "product"):
            tmp = DATA / f"_{kind}.mp4"
            shutil.copy(MEDIA / f"{kind}.mp4", tmp)
            series.keep_clip(cid, kind, tmp, f"{kind}.mp4")
        series.save_settings(cid, {"hooks": ["POV: you finally found it"], "hookSec": [2, 2.5], "productSec": [2, 2.5]})
        sent = []
        job = jobs.submit({"campaign": {"id": cid, "name": "Camp", "posting": {}}, "profile": "prof", "batchId": "b-1",
                           "slots": [{"date": "2026-10-20", "time": "12:00"}, {"date": "2026-10-20", "time": "15:00"}]},
                          "token", "space")
        # Run it here, not on the worker, with a stand-in for the posting function.
        jobs._queue.get_nowait()
        jobs._tokens[job["id"]] = "token"
        jobs.run(job["id"], send=lambda path, **kw: sent.append((path.stat().st_size, kw)) or "post",
                 reword=lambda lines: lines)
        done = jobs.load(job["id"])
        self.assertEqual(done["status"], "done", done.get("error"))
        self.assertEqual(done["sent"] + done["skipped"], 2)
        self.assertGreaterEqual(done["sent"], 1)
        size, kw = sent[0]
        self.assertGreater(size, 0)
        self.assertEqual(kw["key"], "engine-b-1-0")
        self.assertEqual(kw["meta"]["batch"], {"id": "b-1", "date": "2026-10-20", "time": "12:00", "size": 2})
        self.assertEqual(kw["meta"]["headline"], "POV: you finally found it")
        self.assertEqual(list(series.output_dir(cid).glob("*.mp4")), [], "sent videos are let go")

    def test_a_stopped_batch_carries_on(self):
        cid = "camp-again"
        for kind in ("hook", "product"):
            tmp = DATA / f"_{kind}.mp4"
            shutil.copy(MEDIA / f"{kind}.mp4", tmp)
            series.keep_clip(cid, kind, tmp, f"{kind}.mp4")
        slots = [{"date": "2026-10-21", "time": "12:00"}, {"date": "2026-10-21", "time": "15:00"}]
        first = jobs.submit({"campaign": {"id": cid, "name": "C", "posting": {}}, "profile": "p", "batchId": "b-2",
                             "slots": slots}, "token", "space")
        jobs._queue.get_nowait()
        # The first video went, then the engine restarted.
        jobs._update(first["id"], status="stopped", sent=1, done=[0])
        with self.assertRaises(LookupError):
            jobs.again(first["id"], "token", "someone-else")
        second = jobs.again(first["id"], "token2", "space")
        jobs._queue.get_nowait()
        self.assertNotEqual(second["id"], first["id"])
        self.assertEqual((second["batchId"], second["done"], second["sent"], second["total"]), ("b-2", [0], 1, 2))
        self.assertEqual(jobs.load(second["id"])["slots"], slots)
        self.assertEqual(jobs._tokens.pop(second["id"]), "token2")


class Web(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        web.Handler.space_check = staticmethod(lambda token: "space" if token == "good" else None)
        cls.httpd = web.ThreadingHTTPServer(("127.0.0.1", 0), web.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def ask(self, method, path, body=None, token="good", raw=None, origin=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        headers = {"authorization": f"Bearer {token}"} if token else {}
        if origin:
            headers["Origin"] = origin
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read() or b"{}"), res.headers
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}"), err.headers

    def test_needs_a_login(self):
        self.assertEqual(self.ask("GET", "/health", token=None)[0], 200)
        self.assertEqual(self.ask("GET", "/status", token=None)[0], 401)
        self.assertEqual(self.ask("GET", "/status", token="bad")[0], 401)

    def test_only_the_app_may_call_it_from_a_browser(self):
        _, _, headers = self.ask("GET", "/status", origin=config.ALLOWED_ORIGIN)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), config.ALLOWED_ORIGIN)
        _, _, headers = self.ask("GET", "/status", origin="https://elsewhere.example")
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_a_clip_and_a_song_arrive_in_pieces(self):
        clip = (MEDIA / "hook.mp4").read_bytes()
        code, started, _ = self.ask("POST", "/uploads", {"kind": "hook", "campaign": "camp-web", "name": "my hook.mov", "size": len(clip)})
        self.assertEqual(code, 200)
        for i in range(started["parts"]):
            piece = clip[i * started["partBytes"]:(i + 1) * started["partBytes"]]
            self.assertEqual(self.ask("PUT", f"/uploads/{started['id']}/{i}", raw=piece)[0], 200)
        code, done, _ = self.ask("POST", f"/uploads/{started['id']}/finish")
        self.assertEqual(code, 200, done)
        self.assertEqual(done["clip"], "my hook.mov")
        song = (MEDIA / "song.m4a").read_bytes()
        _, started, _ = self.ask("POST", "/uploads", {"kind": "song", "name": "Song.m4a", "size": len(song)})
        self.ask("PUT", f"/uploads/{started['id']}/0", raw=song)
        code, done, _ = self.ask("POST", f"/uploads/{started['id']}/finish")
        self.assertEqual(code, 200, done)
        code, status, _ = self.ask("GET", "/status")
        self.assertEqual(code, 200)
        names = [f["name"] for s in status["series"] if s["campaign"] == "camp-web" for f in s["files"]["hook"]]
        self.assertIn("my hook.mov", names)
        self.assertTrue(any(s["name"] == done["song"] for s in status["songs"]))
        self.assertEqual(self.ask("DELETE", "/series/camp-web/files/hook/my%20hook.mov")[1], {"removed": True})

    def test_a_batch_needs_footage(self):
        code, said, _ = self.ask("POST", "/make", {"campaign": {"id": "empty-camp"}, "profile": "p", "batchId": "b",
                                                    "slots": [{"date": "2026-10-20", "time": "12:00"}]})
        self.assertEqual(code, 400)
        self.assertIn("hook", said["error"])


if __name__ == "__main__":
    unittest.main()


class Hooks(unittest.TestCase):
    """The real Anthropic library, pointed at a stand-in for the API."""

    def test_rewordings_ask_for_json_and_keep_his_lines_first(self):
        import anthropic
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        from engine import hooks

        seen = {}

        class Fake(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):  # noqa: N802
                seen["body"] = json.loads(self.rfile.read(int(self.headers["content-length"])))
                seen["beta"] = self.headers.get("anthropic-beta")
                text = json.dumps({"hooks": [{"original": "POV: it works", "rewordings": ["POV: it finally works", "POV: it actually works"]}]})
                reply = json.dumps({
                    "id": "msg_1", "type": "message", "role": "assistant", "model": hooks.MODEL,
                    "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": 10, "output_tokens": 10},
                }).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            client = anthropic.Anthropic(api_key="test", base_url=f"http://127.0.0.1:{httpd.server_address[1]}", max_retries=0)
            out = hooks.rewordings(["POV: it works"], per_line=2, client=client)
        finally:
            httpd.shutdown()
        self.assertEqual(out, ["POV: it works", "POV: it finally works", "POV: it actually works"])
        self.assertEqual(seen["body"]["model"], "claude-opus-5-5")
        self.assertEqual(seen["body"]["fallbacks"], "default")
        self.assertIn("server-side-fallback-2026-07-01", seen["beta"])
        self.assertEqual(seen["body"]["output_config"]["format"]["type"], "json_schema")

    def test_his_own_lines_without_claude(self):
        from engine import hooks

        class Broken:
            class beta:  # noqa: N801
                class messages:  # noqa: N801
                    @staticmethod
                    def create(**_):
                        raise RuntimeError("no network")

        self.assertEqual(hooks.rewordings(["a hook"], client=Broken()), ["a hook"])

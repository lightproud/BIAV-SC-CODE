"""collect_fanart 纯逻辑单测 — ext / refresh / fetch / main 编排。

urllib.request.urlopen 全打桩；IO 走 tmp；channel_index / jsonl / pixiv json 全合成。
"""

import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import collect_fanart as cf  # noqa: E402


class TestExtOf(unittest.TestCase):
    def test_known_ext(self):
        self.assertEqual(cf.ext_of("a.PNG?x=1"), "png")
        self.assertEqual(cf.ext_of("a.gif"), "gif")

    def test_default(self):
        self.assertEqual(cf.ext_of("noext"), "jpg")
        self.assertEqual(cf.ext_of("noext", default="png"), "png")


class TestFetch(unittest.TestCase):
    def _cm(self, data):
        payload = mock.MagicMock()
        payload.read.return_value = data
        cm = mock.MagicMock()
        cm.__enter__.return_value = payload
        cm.__exit__.return_value = False
        return cm

    def test_ok(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            dest = str(Path(d) / "o.jpg")
            with mock.patch.object(cf.urllib.request, "urlopen", return_value=self._cm(b"x" * 500)):
                self.assertEqual(cf.fetch("https://x/a.jpg", dest), "ok")
            self.assertTrue(Path(dest).exists())

    def test_empty(self):
        with mock.patch.object(cf.urllib.request, "urlopen", return_value=self._cm(b"tiny")):
            self.assertEqual(cf.fetch("https://x/a.jpg", "/tmp/none"), "empty")

    def test_http_error(self):
        err = urllib.error.HTTPError("u", 404, "nf", {}, None)
        with mock.patch.object(cf.urllib.request, "urlopen", side_effect=err):
            self.assertEqual(cf.fetch("https://x/a.jpg", "/tmp/none"), "http_404")

    def test_generic_error(self):
        with mock.patch.object(cf.urllib.request, "urlopen", side_effect=urllib.error.URLError("x")):
            out = cf.fetch("https://x/a.jpg", "/tmp/none")
        self.assertTrue(out.startswith("err_"))

    def test_referer_passed(self):
        captured = {}

        def grab(req, timeout=None):
            captured["req"] = req
            return self._cm(b"x" * 500)
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(cf.urllib.request, "urlopen", side_effect=grab):
                cf.fetch("https://x/a.jpg", str(Path(d) / "o.jpg"), referer="https://ref/")
        self.assertEqual(captured["req"].headers.get("Referer"), "https://ref/")


class TestRefreshDiscord(unittest.TestCase):
    def _cm(self, payload):
        cm = mock.MagicMock()
        cm.__enter__.return_value = payload
        cm.__exit__.return_value = False
        return cm

    def test_maps(self):
        body = {"refreshed_urls": [{"original": "u1", "refreshed": "u1new"}]}
        with mock.patch.object(cf.urllib.request, "urlopen", return_value=self._cm(mock.MagicMock())), \
                mock.patch.object(cf.json, "load", return_value=body), \
                mock.patch.object(cf.time, "sleep"):
            out = cf.refresh_discord(["u1"], "tok")
        self.assertEqual(out, {"u1": "u1new"})

    def test_http_error_swallowed(self):
        err = urllib.error.HTTPError("u", 401, "no", {}, None)
        err.read = lambda: b"detail"
        with mock.patch.object(cf.urllib.request, "urlopen", side_effect=err), \
                mock.patch.object(cf.time, "sleep"):
            self.assertEqual(cf.refresh_discord(["u1"], "tok"), {})

    def test_generic_error_swallowed(self):
        with mock.patch.object(cf.urllib.request, "urlopen", side_effect=ValueError("x")), \
                mock.patch.object(cf.time, "sleep"):
            self.assertEqual(cf.refresh_discord(["u1"], "tok"), {})


class TestMain(unittest.TestCase):
    def _build_root(self, d, with_token_chan=True):
        root = Path(d)
        # channel_index.json
        idx = {"c1": {"dir": "11111111", "name": "同人创作"},
               "c2": {"dir": "22222222", "name": "general-chat"}}
        ddir = root / "discord"
        ddir.mkdir(parents=True)
        (ddir / "channel_index.json").write_text(json.dumps(idx), encoding="utf-8")
        # fanart channel jsonl with an image attachment
        cdir = ddir / "channels" / "11111111"
        cdir.mkdir(parents=True)
        line = json.dumps({"author_id": "u1", "content": "hi",
                           "attachments": [{"content_type": "image/png", "url": "https://d/a.png",
                                            "id": "att1", "filename": "a.png"}]})
        (cdir / "2026-06-01.jsonl").write_text(line + "\n\n", encoding="utf-8")
        # pixiv platform json
        pdir = root / "platforms" / "pixiv"
        pdir.mkdir(parents=True)
        (pdir / "2026-06-01.json").write_text(
            json.dumps({"items": [{"media_url": "https://p/i.jpg", "author": "pa", "title": "t",
                                   "url": "https://pixiv/1"}]}), encoding="utf-8")
        return root

    def _run(self, argv, env, out_dir, fetch_status="ok", refresh=None):
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.dict(cf.os.environ, env, clear=True), \
                mock.patch.object(cf, "fetch", return_value=fetch_status), \
                mock.patch.object(cf, "refresh_discord", return_value=(refresh or {})), \
                mock.patch.object(cf.time, "sleep"):
            cf.main()

    def test_full_run_no_token(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            self._build_root(d)
            out = str(Path(d) / "out")
            with mock.patch.object(cf, "ROOT", str(Path(d))):
                self._run(["prog", "--date", "2026-06-01", "--out", out], {}, out)
            manifest = json.loads(Path(out, "gallery_manifest.json").read_text())
            sources = {g["source"] for g in manifest}
            self.assertIn("discord", sources)
            self.assertIn("pixiv", sources)

    def test_full_run_with_token_refreshes(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            self._build_root(d)
            out = str(Path(d) / "out")
            with mock.patch.object(cf, "ROOT", str(Path(d))), \
                    mock.patch.object(cf, "refresh_discord",
                                      return_value={"https://d/a.png": "https://d/a.png?new"}) as rd:
                with mock.patch.object(sys, "argv", ["prog", "--date", "2026-06-01", "--out", out]), \
                        mock.patch.dict(cf.os.environ, {"DISCORD_BOT_TOKEN": "t"}, clear=True), \
                        mock.patch.object(cf, "fetch", return_value="ok"), \
                        mock.patch.object(cf.time, "sleep"):
                    cf.main()
                rd.assert_called_once()

    def test_run_missing_pixiv_and_jsonl(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            ddir = root / "discord"
            ddir.mkdir(parents=True)
            # channel matches fanart but no jsonl file for the date
            idx = {"c1": {"dir": "11111111", "name": "fanart"}}
            (ddir / "channel_index.json").write_text(json.dumps(idx), encoding="utf-8")
            out = str(root / "out")
            with mock.patch.object(cf, "ROOT", str(root)):
                self._run(["prog", "--date", "2026-06-01", "--out", out], {}, out)
            manifest = json.loads(Path(out, "gallery_manifest.json").read_text())
            self.assertEqual(manifest, [])


if __name__ == "__main__":
    unittest.main()

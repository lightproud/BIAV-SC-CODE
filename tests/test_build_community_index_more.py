"""Extra branch coverage for build_community_index.py.

Drives iter_records / build over synthetic DATA under tmp_path (zero network,
zero release dependency). Targets the malformed-shape skips, max_files
short-circuits in the discord/comments loops, the outer file-level exception
handlers, and the in-memory prune() pruning path.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_community_index as bci


# ---------- iter_records: malformed shapes skipped ----------

def test_platform_items_not_a_list_skipped(tmp_path, monkeypatch):
    # items is a dict (not a list) -> `if not isinstance(items, list): continue` (101).
    data = tmp_path / "data"
    pdir = data / "platforms" / "weibo"
    pdir.mkdir(parents=True)
    (data / "discord").mkdir()
    (pdir / "f.json").write_text(json.dumps({"items": {"not": "a list"}}),
                                 encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    recs = list(bci.iter_records())
    assert recs == []


def test_platform_non_dict_item_skipped(tmp_path, monkeypatch):
    # A list mixing a non-dict and a dict item -> non-dict skipped (104).
    data = tmp_path / "data"
    pdir = data / "platforms" / "weibo"
    pdir.mkdir(parents=True)
    (data / "discord").mkdir()
    (pdir / "f.json").write_text(json.dumps({
        "items": ["i am a string", {"title": "ok", "time": "2026-06-01"}],
    }), encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    recs = list(bci.iter_records())
    # only the dict item survives
    assert len(recs) == 1
    assert recs[0][0] == "weibo"


# ---------- iter_records: max_files short-circuits in later loops ----------

def test_max_files_short_circuits_platform_loop(tmp_path, monkeypatch):
    # max_files counts SOURCES. Post-#333 _sources() yields discord FIRST, then
    # platforms. With max_files=1 the discord source consumes the budget; the
    # later platform source sees seen>=max_files at the top -> early return.
    # No platform (bili) records emitted.
    data = tmp_path / "data"
    pdir = data / "platforms" / "bili"
    pdir.mkdir(parents=True)
    (pdir / "f.json").write_text(json.dumps({
        "items": [{"title": "x", "time": "2026-06-01"}],
    }), encoding="utf-8")
    ddir = data / "discord" / "channels" / "c"
    ddir.mkdir(parents=True)
    (ddir / "2026-06-01.jsonl").write_text(
        json.dumps({"content": "hi", "timestamp": "2026-06-01T00:00:00Z"}) + "\n",
        encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    recs = list(bci.iter_records(max_files=1))
    assert all(r[0] == "discord" for r in recs)
    assert not any(r[0] == "bili" for r in recs)


def test_max_files_short_circuits_comments_loop(tmp_path, monkeypatch):
    # Budget consumed before the *_comments loop -> early return (137).
    data = tmp_path / "data"
    pdir = data / "platforms" / "bili"
    pdir.mkdir(parents=True)
    (pdir / "f.json").write_text(json.dumps({
        "items": [{"title": "x", "time": "2026-06-01"}],
    }), encoding="utf-8")
    (data / "discord").mkdir()
    cdir = data / "platforms" / "youtube_comments"
    cdir.mkdir(parents=True)
    (cdir / "c.jsonl").write_text(
        json.dumps({"text": "yo", "published": "2026-06-01", "likes": 1}) + "\n",
        encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    recs = list(bci.iter_records(max_files=1))
    assert not any(r[0] == "youtube_comments" for r in recs)


# ---------- iter_records: comments loop blank line + bad json ----------

def test_comments_blank_and_bad_json_lines(tmp_path, monkeypatch):
    # blank line skip (145) + bad json inner except (148-149); one good line.
    data = tmp_path / "data"
    (data / "platforms").mkdir(parents=True)
    (data / "discord").mkdir()
    cdir = data / "platforms" / "reddit_comments"
    cdir.mkdir(parents=True)
    (cdir / "c.jsonl").write_text(
        "\n"  # blank
        "{bad json\n"  # unparseable
        + json.dumps({"text": "good comment", "published": "2026-06-04", "likes": 2})
        + "\n",
        encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    recs = [r for r in bci.iter_records() if r[0] == "reddit_comments"]
    assert len(recs) == 1
    assert recs[0][4] == 2  # likes engagement


# ---------- iter_records: outer file-level exception handlers ----------

def test_discord_outer_exception_swallowed(tmp_path, monkeypatch):
    # Make f.open raise for the discord file -> outer except: continue (131-132).
    data = tmp_path / "data"
    (data / "platforms").mkdir(parents=True)
    ddir = data / "discord" / "channels" / "c"
    ddir.mkdir(parents=True)
    target = ddir / "2026-06-01.jsonl"
    target.write_text(json.dumps({"content": "x", "timestamp": "2026-06-01"}) + "\n",
                      encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)

    # discord 读路走 archive_layout.open_archive_text（冷热分层统一开档），桩打在它身上
    def _boom_open(path, *a, **k):
        raise OSError("simulated discord read failure")

    monkeypatch.setattr(bci.archive_layout, "open_archive_text", _boom_open)
    recs = list(bci.iter_records())
    assert not any(r[0] == "discord" for r in recs)


def test_comments_outer_exception_swallowed(tmp_path, monkeypatch):
    # Make f.open raise for the comments file -> outer except: continue (155-156).
    data = tmp_path / "data"
    (data / "platforms").mkdir(parents=True)
    (data / "discord").mkdir()
    cdir = data / "platforms" / "x_comments"
    cdir.mkdir(parents=True)
    (cdir / "c.jsonl").write_text(
        json.dumps({"text": "x", "published": "2026-06-01", "likes": 0}) + "\n",
        encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)

    # comments 读路走 archive_layout.open_archive_text（冷热分层统一开档），桩打在它身上
    real_opener = bci.archive_layout.open_archive_text

    def _boom_open(path, *a, **k):
        if "x_comments" in str(path):
            raise OSError("simulated comments read failure")
        return real_opener(path, *a, **k)

    monkeypatch.setattr(bci.archive_layout, "open_archive_text", _boom_open)
    recs = list(bci.iter_records())
    assert not any(r[0] == "x_comments" for r in recs)


# ---------- build: prune() path ----------

def test_build_triggers_prune(tmp_path, monkeypatch):
    # Force a tiny PRUNE_EVERY / PRUNE_KEEP so prune() runs and actually deletes
    # overflow terms (covers prune() body 173-180 and trigger 199).
    data = tmp_path / "data"
    pdir = data / "platforms" / "bili"
    pdir.mkdir(parents=True)
    (data / "discord").mkdir()
    # 4 records, each with distinct tokens, all in one month.
    items = []
    for i in range(4):
        items.append({"title": f"un<SEP>tokenword{i} extra{i} more{i}",
                      "time": "2026-06-01", "engagement": 1})
    (pdir / "f.json").write_text(json.dumps({"items": items}, ensure_ascii=False),
                                 encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    monkeypatch.setattr(bci, "PRUNE_EVERY", 2)   # prune after every 2 records
    monkeypatch.setattr(bci, "PRUNE_KEEP", 1)    # keep only 1 term per counter

    # Use a deterministic tokenizer so each record yields several distinct tokens,
    # guaranteeing counters exceed PRUNE_KEEP and the deletion loop runs.
    monkeypatch.setattr(bci, "tokenize", lambda text: str(text).replace("<SEP>", " ").split())

    idx = bci.build()
    assert idx["_meta"]["total_records"] == 4
    # After pruning to keep=1 term per (platform, month), top_terms is capped.
    bili = idx["platforms"]["bili"]
    mo = next(iter(bili["by_month"].values()))
    assert len(mo["top_terms"]) <= 1

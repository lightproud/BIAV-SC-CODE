"""test_refresh_claude_code_prompts_unit.py —— refresh_claude_code_prompts 同步/删除语义单测。

风险锚点：同步与删除语义——上游布局变化绝不能静默腐蚀或误删本地参照池。
全程零网络：monkeypatch `run`（git 边界）伪造克隆落地 tmp_path，DEST 指向 tmp 副本，
绝不触碰真实 Public-Info-Pool。

Pinned semantics（读码确认的意图，逐条钉死）：
  - mirror() 只保护顶层 `index.md`（SILVER_OWNED），子目录同名文件不受保护；
  - 上游 `.git` / `.gitignore` 永不入池；
  - 上游删文件 -> 本地对应文件删除、空目录剪除；
  - 克隆失败 / 空克隆（rev-parse HEAD 炸）-> CalledProcessError 响亮上抛，DEST 原封不动。
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import refresh_claude_code_prompts as rcp  # noqa: E402


# ---------- helpers ----------

def _write_tree(base: Path, tree: dict[str, str]) -> None:
    """按 {relpath: content} 落一棵文件树。"""
    for rel, content in tree.items():
        p = base / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


def _snapshot(base: Path) -> dict[str, bytes]:
    """整树快照 {relpath: bytes}，用于逐字节比对（幂等 / 未触碰断言）。"""
    return {
        p.relative_to(base).as_posix(): p.read_bytes()
        for p in sorted(base.rglob("*"))
        if p.is_file()
    }


UPSTREAM_TREE = {
    "README.md": "# claude-code-system-prompts\n\nClaude Code v2.1.201 snapshot.\n",
    "CHANGELOG.md": "changes\n",
    "CLAUDE.md": "upstream claude instructions\n",
    "LICENSE": "MIT\n",
    ".gitignore": "node_modules\n",
    ".git/config": "[core]\n",  # 伪 .git，须被 SKIP_TOP 挡在池外
    "system-prompts/main-loop.md": "---\nversion: v2.1.201\n---\nmain\n",
    "system-prompts/subagent-explore.md": "---\nversion: v2.1.201\n---\nexplore\n",
}


def _make_fake_run(tree: dict[str, str], sha: str = "a" * 40,
                   date: str = "2026-07-06"):
    """伪 git 边界：clone = 把 tree 落到目标目录；rev-parse/show 返回定值。

    小学生比喻：不真去邮局取包裹，而是让测试自己把包裹放到门口，
    看后面的分拣流水线（mirror / 改名 / 建 index）搬得对不对。
    """
    def fake_run(cmd, cwd=None):
        if cmd[:2] == ["git", "clone"]:
            clone_dir = Path(cmd[-1])
            clone_dir.mkdir(parents=True, exist_ok=True)
            _write_tree(clone_dir, tree)
            return ""
        if cmd[:2] == ["git", "rev-parse"]:
            return sha
        if cmd[:2] == ["git", "show"]:
            return date
        raise AssertionError(f"unexpected command: {cmd}")

    return fake_run


@pytest.fixture()
def dest(tmp_path, monkeypatch):
    """把 DEST 指向 tmp 参照池副本——真实 Public-Info-Pool 绝不入镜。"""
    d = tmp_path / "pool" / "Claude-Code-System-Prompts"
    monkeypatch.setattr(rcp, "DEST", d)
    return d


# ---------- mirror: 拷贝 + SKIP_TOP ----------

def test_mirror_copies_tree_and_strips_git_metadata(tmp_path):
    src = tmp_path / "src"
    _write_tree(src, UPSTREAM_TREE)
    dst = tmp_path / "dst"
    dst.mkdir()

    rcp.mirror(src, dst)

    assert (dst / "README.md").read_text(encoding="utf-8") == UPSTREAM_TREE["README.md"]
    assert (dst / "system-prompts" / "main-loop.md").exists()
    # .git / .gitignore 永不入池
    assert not (dst / ".git").exists()
    assert not (dst / ".gitignore").exists()


def test_mirror_overwrites_stale_content(tmp_path):
    """上游同名文件内容变了 -> 本地被覆盖为新内容（不残留旧字节）。"""
    src = tmp_path / "src"
    _write_tree(src, {"a.md": "new\n"})
    dst = tmp_path / "dst"
    _write_tree(dst, {"a.md": "old\n"})

    rcp.mirror(src, dst)
    assert (dst / "a.md").read_text(encoding="utf-8") == "new\n"


# ---------- mirror: 删除语义（风险锚点） ----------

def test_mirror_deletes_files_removed_upstream_and_prunes_empty_dirs(tmp_path):
    """上游删了文件 -> 本地对应文件删除，空目录一并剪除。"""
    src = tmp_path / "src"
    _write_tree(src, {"kept.md": "k\n"})
    dst = tmp_path / "dst"
    _write_tree(dst, {
        "kept.md": "k\n",
        "gone.md": "g\n",
        "old-dir/nested.md": "n\n",
    })

    rcp.mirror(src, dst)

    assert (dst / "kept.md").exists()
    assert not (dst / "gone.md").exists()
    assert not (dst / "old-dir").exists()  # 空目录剪除


def test_mirror_protects_top_level_index_md(tmp_path):
    """银芯自持 index.md（SILVER_OWNED）不因上游没有而被删。"""
    src = tmp_path / "src"
    _write_tree(src, {"README.md": "r\n"})
    dst = tmp_path / "dst"
    _write_tree(dst, {"index.md": "silver provenance\n"})

    rcp.mirror(src, dst)
    assert (dst / "index.md").read_text(encoding="utf-8") == "silver provenance\n"


def test_mirror_nested_index_md_is_not_protected(tmp_path):
    """Pin 现行语义：SILVER_OWNED 按顶层相对路径匹配，子目录 index.md 不受保护。

    （即 `sub/index.md` 的 rel 是 "sub/index.md"，不等于 "index.md"，照删。）
    """
    src = tmp_path / "src"
    _write_tree(src, {"README.md": "r\n"})
    dst = tmp_path / "dst"
    _write_tree(dst, {"index.md": "keep\n", "sub/index.md": "not protected\n"})

    rcp.mirror(src, dst)
    assert (dst / "index.md").exists()
    assert not (dst / "sub").exists()


def test_mirror_upstream_rename_moves_file(tmp_path):
    """上游改名 = 旧名删除 + 新名出现，不留双份。"""
    src = tmp_path / "src"
    _write_tree(src, {"system-prompts/new-name.md": "body\n"})
    dst = tmp_path / "dst"
    _write_tree(dst, {"system-prompts/old-name.md": "body\n"})

    rcp.mirror(src, dst)
    assert (dst / "system-prompts" / "new-name.md").exists()
    assert not (dst / "system-prompts" / "old-name.md").exists()


# ---------- detect_version ----------

def test_detect_version_from_readme(tmp_path):
    _write_tree(tmp_path, {"README.md": "Claude Code v2.1.201 stuff\n"})
    assert rcp.detect_version(tmp_path) == "2.1.201"


def test_detect_version_fallback_to_frontmatter(tmp_path):
    _write_tree(tmp_path, {
        "README.md": "no version marker here\n",
        "system-prompts/a.md": "---\nversion: v9.8.7\n---\nbody\n",
    })
    assert rcp.detect_version(tmp_path) == "9.8.7"


def test_detect_version_unknown_when_absent(tmp_path):
    _write_tree(tmp_path, {"README.md": "nothing\n"})
    assert rcp.detect_version(tmp_path) == "unknown"


# ---------- render_index ----------

def test_render_index_embeds_provenance_fields():
    out = rcp.render_index("2.1.201", "deadbeef" * 5, "2026-07-06", 42)
    assert "Claude Code v2.1.201" in out
    assert "deadbeef" in out
    assert "2026-07-06" in out
    assert "**42**" in out


# ---------- main(): happy path / 幂等 / 布局变化 ----------

def test_main_fresh_sync_into_empty_dest(dest, monkeypatch, capsys):
    """(a)+(e) 空目的地全新同步：文件齐、CLAUDE.md 改名、index.md 生成、exit 0。"""
    monkeypatch.setattr(rcp, "run", _make_fake_run(UPSTREAM_TREE))

    assert rcp.main() == 0

    assert (dest / "README.md").exists()
    assert (dest / "CHANGELOG.md").exists()
    assert (dest / "LICENSE").exists()
    assert (dest / "system-prompts" / "main-loop.md").exists()
    # 上游 CLAUDE.md 必须改名（防银芯指令层污染），原名不得残留
    assert not (dest / "CLAUDE.md").exists()
    assert (dest / "UPSTREAM-CLAUDE.md").read_text(encoding="utf-8") == (
        "upstream claude instructions\n"
    )
    # .git / .gitignore 不入池
    assert not (dest / ".git").exists()
    assert not (dest / ".gitignore").exists()
    # index.md provenance：版本 / commit / 提示词计数
    idx = (dest / "index.md").read_text(encoding="utf-8")
    assert "Claude Code v2.1.201" in idx
    assert "a" * 40 in idx
    assert "**2**" in idx  # system-prompts 下 2 份 md
    assert "2 prompts" in capsys.readouterr().out


def test_main_is_idempotent(dest, monkeypatch):
    """(b) 连跑两次，整树逐字节相同（index.md 刻意不含本地刷新日期）。"""
    monkeypatch.setattr(rcp, "run", _make_fake_run(UPSTREAM_TREE))

    assert rcp.main() == 0
    first = _snapshot(dest)
    assert rcp.main() == 0
    second = _snapshot(dest)
    assert first == second
    assert first  # 非空树，防两边都空的假阳性


def test_main_upstream_layout_change_removes_only_stale_files(dest, monkeypatch):
    """(c) 上游布局变化：删的删、加的加，index.md 与其余文件不受波及。"""
    monkeypatch.setattr(rcp, "run", _make_fake_run(UPSTREAM_TREE))
    assert rcp.main() == 0
    assert (dest / "system-prompts" / "subagent-explore.md").exists()

    # 上游第二周：删 subagent-explore.md、新增 subagent-plan.md
    changed = {k: v for k, v in UPSTREAM_TREE.items()
               if k != "system-prompts/subagent-explore.md"}
    changed["system-prompts/subagent-plan.md"] = "---\nversion: v2.1.202\n---\nplan\n"
    monkeypatch.setattr(rcp, "run", _make_fake_run(changed, sha="b" * 40))
    assert rcp.main() == 0

    assert not (dest / "system-prompts" / "subagent-explore.md").exists()
    assert (dest / "system-prompts" / "subagent-plan.md").exists()
    assert (dest / "README.md").exists()
    assert (dest / "index.md").exists()
    assert "b" * 40 in (dest / "index.md").read_text(encoding="utf-8")


# ---------- main(): 失败路径（DEST 原封不动） ----------

def test_main_clone_failure_raises_and_leaves_dest_untouched(dest, monkeypatch):
    """(d1) git clone 失败 -> CalledProcessError 响亮上抛，参照池逐字节原样。"""
    _write_tree(dest, {"index.md": "provenance\n", "system-prompts/a.md": "a\n"})
    before = _snapshot(dest)

    def failing_run(cmd, cwd=None):
        raise subprocess.CalledProcessError(128, cmd)

    monkeypatch.setattr(rcp, "run", failing_run)
    with pytest.raises(subprocess.CalledProcessError):
        rcp.main()
    assert _snapshot(dest) == before


def test_main_empty_clone_raises_and_leaves_dest_untouched(dest, monkeypatch):
    """(d2) 空克隆：clone 成功但仓库无 HEAD（真实 git 在 rev-parse 就炸）——
    须响亮失败，绝不拿空树把参照池 mirror 成白板。"""
    _write_tree(dest, {"index.md": "provenance\n", "system-prompts/a.md": "a\n"})
    before = _snapshot(dest)

    def empty_clone_run(cmd, cwd=None):
        if cmd[:2] == ["git", "clone"]:
            Path(cmd[-1]).mkdir(parents=True, exist_ok=True)  # 空目录，无任何文件
            return ""
        if cmd[:2] == ["git", "rev-parse"]:
            # 真实 git 对空仓库 rev-parse HEAD 的行为：非零退出
            raise subprocess.CalledProcessError(128, cmd)
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(rcp, "run", empty_clone_run)
    with pytest.raises(subprocess.CalledProcessError):
        rcp.main()
    assert _snapshot(dest) == before


# ---------- run(): 真 subprocess 边界（本地无网命令） ----------

def test_run_returns_stripped_stdout_and_raises_on_failure():
    """run() 用 check=True：成功回 strip 后 stdout，失败必抛（响亮失败的根）。"""
    assert rcp.run([sys.executable, "-c", "print('  ok  ')"]) == "ok"
    with pytest.raises(subprocess.CalledProcessError):
        rcp.run([sys.executable, "-c", "import sys; sys.exit(3)"])

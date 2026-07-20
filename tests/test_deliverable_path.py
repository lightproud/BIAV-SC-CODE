"""锁定 scripts/deliverable_path.py 的强约束契约：确定性路径 + 挡同义分裂 + 形式守卫。

覆盖测量说明（P2, 2026-07-02）：本档主体经 import 直调 `main()`（monkeypatch sys.argv），
让 coverage 在同进程内看见真实执行——旧版全部经 subprocess 驱动 CLI，覆盖率恒测 0%
（跨进程失明）。仅保留少量 subprocess 冒烟测试验「python 脚本入口真的能跑」。
写状态的子命令（register / promote / rename-type）把模块级路径常量重定向到 tmp，
绝不碰真实 Public-Info-Pool/types.json。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import deliverable_path as dp  # noqa: E402

SCRIPT = ROOT / "scripts" / "deliverable_path.py"
REGISTRY = ROOT / "Public-Info-Pool" / "types.json"


def run_cli(monkeypatch, capsys, *args):
    """同进程驱动 main()。返回 (exit_code, stdout, stderr)。"""
    monkeypatch.setattr(sys, "argv", ["deliverable_path.py", *args])
    code = 0
    try:
        dp.main()
    except SystemExit as e:
        code = int(e.code or 0)
    out = capsys.readouterr()
    return code, out.out, out.err


@pytest.fixture
def sandbox(monkeypatch, tmp_path):
    """把注册表与 Resource/ 根重定向到 tmp，供写状态子命令安全排练。"""
    registry = tmp_path / "types.json"
    registry.write_text(json.dumps({
        "types": {
            "daily-news": {"desc": "", "status": "provisional"},
            "game-analysis": {"desc": "", "status": "provisional"},
        }
    }, ensure_ascii=False), encoding="utf-8")
    resource = tmp_path / "Resource"
    resource.mkdir()
    monkeypatch.setattr(dp, "REGISTRY", registry)
    monkeypatch.setattr(dp, "RESOURCE", resource)
    # dp.ROUGH 常量已随死代码清理移除（PR #373）：promote 取显式 src 路径，
    # 脚本不依赖 Rough 根常量，这里无需重定向。
    monkeypatch.setattr(dp, "REPO_ROOT", tmp_path)
    return tmp_path


# --- path 子命令（读真实注册表，无写副作用） ---

def test_path_deterministic(monkeypatch, capsys):
    code, out, err = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "morimens-daily", "--date", "20260601")
    assert code == 0, err
    assert out.strip() == "Public-Info-Pool/Resource/daily-news/morimens-daily-20260601.md"


def test_same_inputs_same_path(monkeypatch, capsys):
    a = run_cli(monkeypatch, capsys,
                "path", "--type", "game-analysis", "--topic", "foo", "--date", "20260601")
    b = run_cli(monkeypatch, capsys,
                "path", "--type", "game-analysis", "--topic", "foo", "--date", "20260601")
    assert a[1] == b[1]


def test_revision_suffix(monkeypatch, capsys):
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "x", "--date", "20260601",
        "--rev", "2", "--ext", "pdf")
    assert code == 0
    assert out.strip().endswith("x-20260601-r2.pdf")


def test_rev1_no_suffix(monkeypatch, capsys):
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "x", "--date", "20260601", "--rev", "1")
    assert code == 0
    assert out.strip().endswith("x-20260601.md")


def test_month_precision_date_accepted(monkeypatch, capsys):
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "x", "--date", "202606")
    assert code == 0
    assert out.strip().endswith("x-202606.md")


def test_range_date_accepted(monkeypatch, capsys):
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "x", "--date", "20260601-15")
    assert code == 0
    assert out.strip().endswith("x-20260601-15.md")


def test_unregistered_type_rejected_with_near_match_hint(monkeypatch, capsys):
    code, _, err = run_cli(
        monkeypatch, capsys,
        "path", "--type", "dailynews", "--topic", "x", "--date", "20260601")
    assert code == 1
    assert "未登记" in err
    assert "daily-news" in err  # near-match 提示防同义分裂


def test_underscore_form_rejected(monkeypatch, capsys):
    code, _, err = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily_news", "--topic", "x", "--date", "20260601")
    assert code == 1
    assert "形式不合规" in err


def test_bad_topic_rejected(monkeypatch, capsys):
    code, _, err = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "Bad_Topic", "--date", "20260601")
    assert code == 1
    assert "形式不合规" in err


def test_bad_date_rejected(monkeypatch, capsys):
    code, _, err = run_cli(
        monkeypatch, capsys,
        "path", "--type", "daily-news", "--topic", "x", "--date", "2026-06-01")
    assert code == 1
    assert "日期" in err


# --- list 子命令 ---

def test_list_shows_registered_types(monkeypatch, capsys):
    code, out, _ = run_cli(monkeypatch, capsys, "list")
    assert code == 0
    assert "daily-news" in out
    assert "repo-engineering" in out


# --- register 子命令（tmp 沙箱） ---

def test_register_new_type(sandbox, monkeypatch, capsys):
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "register", "--type", "wiki-build", "--desc", "wiki 站点构建产物")
    assert code == 0
    assert "已登记类型 'wiki-build'" in out
    reg = json.loads(dp.REGISTRY.read_text(encoding="utf-8"))
    assert reg["types"]["wiki-build"] == {"desc": "wiki 站点构建产物", "status": "provisional"}
    assert (dp.RESOURCE / "wiki-build").is_dir()


def test_register_duplicate_rejected(sandbox, monkeypatch, capsys):
    code, _, err = run_cli(monkeypatch, capsys, "register", "--type", "daily-news")
    assert code == 1
    assert "已存在" in err


def test_register_near_match_blocked_without_force(sandbox, monkeypatch, capsys):
    code, _, err = run_cli(monkeypatch, capsys, "register", "--type", "daily-new")
    assert code == 1
    assert "同义分裂" in err
    # 注册表未被污染
    reg = json.loads(dp.REGISTRY.read_text(encoding="utf-8"))
    assert "daily-new" not in reg["types"]


def test_register_near_match_allowed_with_force(sandbox, monkeypatch, capsys):
    code, out, _ = run_cli(monkeypatch, capsys, "register", "--type", "daily-new", "--force")
    assert code == 0
    reg = json.loads(dp.REGISTRY.read_text(encoding="utf-8"))
    assert "daily-new" in reg["types"]


def test_register_keeps_registry_sorted(sandbox, monkeypatch, capsys):
    run_cli(monkeypatch, capsys, "register", "--type", "aaa-first")
    reg = json.loads(dp.REGISTRY.read_text(encoding="utf-8"))
    names = list(reg["types"])
    assert names == sorted(names)


# --- promote 子命令（tmp 沙箱） ---

def test_promote_moves_draft_into_resource(sandbox, monkeypatch, capsys):
    draft = sandbox / "Rough"
    draft.mkdir()
    src = draft / "draft.md"
    src.write_text("草稿内容", encoding="utf-8")
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "promote", str(src), "--type", "daily-news", "--topic", "foo", "--date", "20260621")
    assert code == 0
    dst = dp.RESOURCE / "daily-news" / "foo-20260621.md"
    assert dst.read_text(encoding="utf-8") == "草稿内容"
    assert not src.exists()


def test_promote_inherits_ext_from_source(sandbox, monkeypatch, capsys):
    src = sandbox / "draft.html"
    src.write_text("x", encoding="utf-8")
    code, out, _ = run_cli(
        monkeypatch, capsys,
        "promote", str(src), "--type", "daily-news", "--topic", "foo", "--date", "20260621")
    assert code == 0
    assert (dp.RESOURCE / "daily-news" / "foo-20260621.html").exists()


def test_promote_missing_source_rejected(sandbox, monkeypatch, capsys):
    code, _, err = run_cli(
        monkeypatch, capsys,
        "promote", str(sandbox / "nope.md"),
        "--type", "daily-news", "--topic", "foo", "--date", "20260621")
    assert code == 1
    assert "草稿不存在" in err


def test_promote_unregistered_type_rejected(sandbox, monkeypatch, capsys):
    src = sandbox / "draft.md"
    src.write_text("x", encoding="utf-8")
    code, _, err = run_cli(
        monkeypatch, capsys,
        "promote", str(src), "--type", "nope", "--topic", "foo", "--date", "20260621")
    assert code == 1
    assert "未登记" in err
    assert src.exists()  # 拒绝时草稿原地不动


# --- rename-type 子命令（tmp 沙箱） ---

def test_rename_type_moves_dir_and_registry(sandbox, monkeypatch, capsys):
    old_dir = dp.RESOURCE / "daily-news"
    old_dir.mkdir()
    (old_dir / "a.md").write_text("x", encoding="utf-8")
    code, out, _ = run_cli(monkeypatch, capsys, "rename-type", "daily-news", "news-daily")
    assert code == 0
    assert not old_dir.exists()
    assert (dp.RESOURCE / "news-daily" / "a.md").exists()
    reg = json.loads(dp.REGISTRY.read_text(encoding="utf-8"))
    assert "news-daily" in reg["types"] and "daily-news" not in reg["types"]


def test_rename_type_unknown_old_rejected(sandbox, monkeypatch, capsys):
    code, _, err = run_cli(monkeypatch, capsys, "rename-type", "nope", "new-name")
    assert code == 1
    assert "未登记" in err


def test_rename_type_collision_rejected(sandbox, monkeypatch, capsys):
    code, _, err = run_cli(monkeypatch, capsys, "rename-type", "daily-news", "game-analysis")
    assert code == 1
    assert "已存在" in err


def test_missing_registry_dies(sandbox, monkeypatch, capsys):
    dp.REGISTRY.unlink()
    code, _, err = run_cli(monkeypatch, capsys, "list")
    assert code == 1
    assert "注册表不存在" in err


# --- 真实注册表形式不变量 ---

def test_registry_form_compliant():
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    kebab = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    for name in data["types"]:
        assert kebab.match(name), f"类型名 '{name}' 违反 kebab-case 形式约定"


# --- subprocess 冒烟（验 CLI 入口真的能作为脚本跑；主体覆盖走上面的同进程路径） ---

def _run_smoke(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


def test_smoke_cli_path_ok():
    r = _run_smoke("path", "--type", "daily-news", "--topic", "morimens-daily", "--date", "20260601")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "Public-Info-Pool/Resource/daily-news/morimens-daily-20260601.md"


def test_smoke_cli_rejection_exit_code():
    r = _run_smoke("path", "--type", "dailynews", "--topic", "x", "--date", "20260601")
    assert r.returncode == 1
    assert "未登记" in r.stderr


def test_smoke_cli_list():
    r = _run_smoke("list")
    assert r.returncode == 0
    assert "daily-news" in r.stdout

"""bpa-dev 组装套件守卫：补丁应用器行为 + 零内网值纪律。"""
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
KIT = REPO / "projects" / "black-pool-agent" / "deploy"


def _apply(root: Path, patch: str, check: bool = False) -> subprocess.CompletedProcess:
    p = root / "_t.patch"
    p.write_text(patch, encoding="utf-8")
    args = [sys.executable, str(KIT / "apply_patch.py"), "--root", str(root)]
    if check:
        args.append("--check")
    return subprocess.run([*args, str(p)], capture_output=True, text=True)


MOD_PATCH = """diff --git a/x.py b/x.py
--- a/x.py
+++ b/x.py
@@ -1,3 +1,3 @@
 a = 1
-b = 2
+b = 20
 c = 3
"""


def test_modify_applies(tmp_path):
    (tmp_path / "x.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == "a = 1\nb = 20\nc = 3\n"


def test_context_mismatch_fails_loud_and_writes_nothing(tmp_path):
    original = "a = 1\nb = 999\nc = 3\n"
    (tmp_path / "x.py").write_text(original, encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 1
    assert "上下文匹配失败" in r.stderr
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == original


def test_drifted_context_found_within_window(tmp_path):
    pad = "".join(f"pad{i} = 0\n" for i in range(10))
    (tmp_path / "x.py").write_text(pad + "a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    assert "b = 20" in (tmp_path / "x.py").read_text(encoding="utf-8")


def test_new_file_creation(tmp_path):
    patch = """diff --git a/new.py b/new.py
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
"""
    r = _apply(tmp_path, patch)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "new.py").read_text(encoding="utf-8") == "x = 1\ny = 2\n"


def test_crlf_target_preserved(tmp_path):
    with (tmp_path / "x.py").open("w", encoding="utf-8", newline="") as fh:
        fh.write("a = 1\r\nb = 2\r\nc = 3\r\n")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    with (tmp_path / "x.py").open(encoding="utf-8", newline="") as fh:
        raw = fh.read()
    assert raw == "a = 1\r\nb = 20\r\nc = 3\r\n"


def test_check_mode_does_not_write(tmp_path):
    (tmp_path / "x.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH, check=True)
    assert r.returncode == 0, r.stderr
    assert "b = 2\n" in (tmp_path / "x.py").read_text(encoding="utf-8")


def test_multi_hunk_all_or_nothing(tmp_path):
    """第二 hunk 匹配失败时第一 hunk 也不得落盘（先全量 check 再写）。"""
    original = "a = 1\nb = 2\nc = 3\nd = 4\ne = XXX\nf = 6\n"
    (tmp_path / "x.py").write_text(original, encoding="utf-8")
    patch = """diff --git a/x.py b/x.py
--- a/x.py
+++ b/x.py
@@ -1,3 +1,3 @@
 a = 1
-b = 2
+b = 20
 c = 3
@@ -4,3 +4,3 @@
 d = 4
-e = 5
+e = 50
 f = 6
"""
    r = _apply(tmp_path, patch)
    assert r.returncode == 1
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == original


@pytest.mark.parametrize("name", ["assemble.cmd", "deploy.cmd", "rollback.cmd",
                                  "apply_patch.py", "assemble_inject.py",
                                  "assembly.sample.txt"])
def test_kit_has_zero_intranet_values(name):
    """通用件纪律：脚本内不得出现网络端点/内网值（文书裁 5 切面化）。"""
    text = (KIT / name).read_text(encoding="utf-8").lower()
    for marker in ("http://", "https://", "idealab", "api_key", "token="):
        assert marker not in text, f"{name} 含疑似内网值/端点标记: {marker}"


def test_kit_files_complete():
    for name in ["assemble.cmd", "deploy.cmd", "rollback.cmd", "update.cmd",
                 "apply_patch.py",
                 "RUNBOOK.md", "launcher.cmd", "launch_desktop.py", "fix_venv_path.py",
                 "make-shortcut.vbs", "kill_by_path.py", "assemble_inject.py",
                 "assembly.sample.txt", "diagnose.cmd", "diagnose_lag.py"]:
        assert (KIT / name).is_file(), f"bpa-dev 套件缺件: {name}"


def test_fix_venv_path_derives_old_root_without_stamp(tmp_path):
    """2026-08-03 内网首部署野战回归：bundle-root.txt 印章缺失时，旧根必须能从
    editable 指针文件反推——否则自愈整段跳过、导入自检必挂。"""
    (tmp_path / "python" / "cpython-3.11.14-test").mkdir(parents=True)
    site = tmp_path / "venv" / "Lib" / "site-packages"
    site.mkdir(parents=True)
    (tmp_path / "venv" / "pyvenv.cfg").write_text(
        "home = C:\\old\\python\nversion = 3.11\n", encoding="utf-8")
    (site / "x.pth").write_text("D:\\a\\ws\\BlackPool\\app\n", encoding="utf-8")
    (site / "__editable__.hermes.py").write_text(
        "M = {'hermes_cli': 'D:\\\\a\\\\ws\\\\BlackPool\\\\app\\\\hermes_cli'}\n",
        encoding="utf-8")
    r = subprocess.run([sys.executable, str(KIT / "fix_venv_path.py"), str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "derived from editable pointers" in r.stdout
    assert "BlackPool" not in (site / "x.pth").read_text(encoding="utf-8")
    assert "BlackPool" not in (site / "__editable__.hermes.py").read_text(encoding="utf-8")
    assert (tmp_path / "bundle-root.txt").read_text(encoding="utf-8").strip() == str(tmp_path)
    r2 = subprocess.run([sys.executable, str(KIT / "fix_venv_path.py"), str(tmp_path)],
                        capture_output=True, text=True)
    assert r2.returncode == 0, "二跑必须幂等直通"


def test_launcher_kit_mode_dispatch_present():
    """车间双模入口（守密人 2026-08-03 诉求）：kit 里双击 launcher 须能经
    deploy-target.txt 转发到部署位，且 kit 模式零写入（vendor 外链只读）。"""
    text = (KIT / "launcher.cmd").read_text(encoding="utf-8")
    assert "deploy-target.txt" in text and ":in_bundle" in text, (
        "launcher.cmd 车间转发模式缺失"
    )


@pytest.mark.parametrize("name", ["launcher.cmd", "assemble.cmd", "deploy.cmd",
                                  "rollback.cmd", "update.cmd"])
def test_cmd_rem_lines_are_ascii_short(name):
    """chcp 65001 解析器错位野战回归（两案实证）：套件 cmd 的 rem 行必须 ASCII 短行。"""
    for line in (KIT / name).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.lower().startswith("rem"):
            assert s.isascii(), f"{name} rem 行含非 ASCII（65001 错位风险）: {s[:60]}"
            assert len(s) <= 100, f"{name} rem 行超长: {s[:60]}"


@pytest.mark.parametrize("name", ["launcher.cmd", "assemble.cmd", "deploy.cmd",
                                  "rollback.cmd", "update.cmd", "black-pool-update.cmd"])
def test_cmd_no_path_expansion_inside_paren_blocks(name):
    """2026-08-04 野战回归（update.cmd 首战「双击闪退」类）：( ) 块内展开
    %~f0 / %~dp0 / %*，一旦路径或参数含 ASCII 括号（Explorer 重名改 "xxx (1)"、
    带括号目录），展开出的 ) 提前闭块、语法错乱、窗口秒关零留痕。
    引导块一律 goto 式；括号块内禁这三类展开。"""
    depth = 0
    for i, line in enumerate((KIT / name).read_text(encoding="utf-8").splitlines(), 1):
        s = line.strip()
        if s.lower().startswith("rem"):
            continue
        if depth > 0:
            for tok in ("%~f0", "%~dp0", "%*"):
                assert tok not in line, f"{name}:{i} 括号块内展开 {tok}: {s[:60]}"
        depth = max(0, depth + s.count("(") - s.count(")"))
    text = (KIT / name).read_text(encoding="utf-8")
    assert "KEEPWIN (" not in text, f"{name} 开窗引导块仍是括号式（应为 goto 式）"


def test_update_cmd_temp_reexec_is_name_gated():
    """update.cmd 自拷 TEMP 重执行须按文件名识别（bpa-update-run.cmd），不得用
    环境旗标——复用窗口残留旗标会让可被步骤①②改写的原件直接跑（解析错乱源）。"""
    text = (KIT / "update.cmd").read_text(encoding="utf-8")
    assert 'if /i "%~nx0"=="bpa-update-run.cmd"' in text
    assert "BPA_UPD_TMP" not in text, "环境旗标门控应已退役，改文件名门控"
    assert "black-pool-update-boot.log" in text, "闪退取证面包屑缺失"


def test_native_launcher_source_present_and_wired():
    """无感原生外壳（守密人 2026-08-03 诉求）：C# 源在位且两条装配线都有编译步。"""
    cs = KIT.parent / "build" / "black-pool-launcher.cs"
    assert cs.is_file() and "winexe" in cs.read_text(encoding="utf-8")
    for wf in ("assemble-black-pool-bundle.yml", "assemble-black-pool-public.yml"):
        text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "black-pool-launcher.cs" in text and "win32icon" in text, f"{wf} 缺编译步"
    launcher = (KIT / "launcher.cmd").read_text(encoding="utf-8")
    assert "BPA_SILENT" in launcher and "%PAUSE_C%" in launcher, "launcher 静默模式缺失"


def test_deploy_has_mirror_fallback_and_ascii_label_blocks():
    """2026-08-04 野战回归（第三案）：① 改名被 CWD 型占用挡死时必须有就地
    镜像退路（robocopy /mir 短重试）——CWD 锁只挡改名不挡覆盖；② goto 标签
    之后的失败/回退块整块 ASCII——块内 UTF-8 echo 会让 65001 解析器错位，
    把半截汉字当命令执行。"""
    text = (KIT / "deploy.cmd").read_text(encoding="utf-8")
    assert ":rot_mirror" in text and "/mir" in text and "/r:2" in text, (
        "deploy.cmd 缺就地镜像退路"
    )
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == ":rot_mirror")
    end = next(i for i, l in enumerate(lines) if l.strip() == ":post_deploy")
    block = lines[start:end]
    bad = [l for l in block if not l.isascii()]
    assert not bad, f"rot_mirror 块含非 ASCII 行（65001 错位风险）: {bad[:2]}"
    assert not any("goto rot_fail" in l for l in lines), (
        "旧 rot_fail 死路残留——应全部改走 rot_mirror 退路"
    )


def _make_devroot(tmp_path):
    """搭一个最小 bpa-dev 车间 + staging 包骨架供注入器实跑。"""
    dev = tmp_path / "bpa-dev"
    bundle = dev / "staging" / "BlackPool"
    (bundle / "app" / "hermes_cli").mkdir(parents=True)
    (bundle / "app" / "hermes_cli" / "__init__.py").write_text(
        '__version__ = "0.1.0"\n', encoding="utf-8")
    (bundle / "app" / "x.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    (dev / "patches").mkdir()
    (dev / "patches" / "a-on.patch").write_text(MOD_PATCH, encoding="utf-8")
    (dev / "patches" / "b-off.patch").write_text(
        MOD_PATCH.replace("b = 20", "b = 99"), encoding="utf-8")
    (dev / "config").mkdir()
    (dev / "config" / "env.cmd").write_text(
        'set "SECRET_MARKER_XYZZY=do-not-leak"\n', encoding="utf-8")
    (dev / "plugins" / "memory" / "demo").mkdir(parents=True)
    (dev / "plugins" / "memory" / "demo" / "plugin.yaml").write_text(
        "name: demo\nversion: 9.9\n", encoding="utf-8")
    (dev / "plugins" / "memory" / "demo" / "__init__.py").write_text(
        "# demo\n", encoding="utf-8")
    (dev / "skills").mkdir()
    (dev / "skills" / "sk1").mkdir()
    (dev / "skills" / "sk1" / "SKILL.md").write_text("x\n", encoding="utf-8")
    (dev / "config" / "assembly.txt").write_text(
        "[patches]\n* = on\nb-off.patch = off\n", encoding="utf-8")
    return dev, bundle


def test_assemble_inject_selection_manifest_and_secret_redline(tmp_path):
    """注入器三合一守卫：① 选装表 off 的补丁不打且清单点名跳过；
    ② ASSEMBLY.md / MANIFEST.txt 生成且记录在案；
    ③ env.cmd 内容（凭据形值）绝不落清单——只记指纹。"""
    dev, bundle = _make_devroot(tmp_path)
    r = subprocess.run(
        [sys.executable, str(KIT / "assemble_inject.py"),
         "--devroot", str(dev), "--bundle", str(bundle)],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    # 选装：a-on 打了，b-off 没打
    x = (bundle / "app" / "x.py").read_text(encoding="utf-8")
    assert "b = 20" in x and "b = 99" not in x
    md = (bundle / "ASSEMBLY.md").read_text(encoding="utf-8")
    assert "a-on.patch" in md and "b-off.patch" in md
    assert "跳过" in md
    # 注入落位
    assert (bundle / "env.cmd").is_file()
    assert (bundle / "app" / "plugins" / "memory" / "demo" / "plugin.yaml").is_file()
    assert (bundle / "home" / "skills" / "sk1" / "SKILL.md").is_file()
    # 红线：凭据内容不进任何清单
    manifest = (bundle / "MANIFEST.txt").read_text(encoding="utf-8")
    for doc in (md, manifest):
        assert "SECRET_MARKER_XYZZY" not in doc and "do-not-leak" not in doc
    assert "patches-applied: 1" in manifest
    # 版本探明
    assert "0.1.0" in md


def test_assemble_inject_failed_patch_fails_loud(tmp_path):
    dev, bundle = _make_devroot(tmp_path)
    (dev / "config" / "assembly.txt").unlink()  # 全拼：b-off 与 a-on 改同一行必炸
    r = subprocess.run(
        [sys.executable, str(KIT / "assemble_inject.py"),
         "--devroot", str(dev), "--bundle", str(bundle)],
        capture_output=True, text=True)
    assert r.returncode == 1
    assert "补丁应用失败" in r.stdout


def test_assemble_cmd_delegates_injection():
    text = (KIT / "assemble.cmd").read_text(encoding="utf-8")
    assert "assemble_inject.py" in text, "assemble.cmd 未接入注入器"
    assert "robocopy" not in text, "旧 cmd 注入残留（应全部移交 assemble_inject.py）"
    assert "ASSEMBLY.md" in text


def test_ci_bakes_build_manifest_into_bundle():
    """两级拼装链条自洽（守密人 2026-08-04 裁定）：第一级（银芯 CI）须在包内
    烘 BUILD.md（版别/产品版本/pin/commit/烧入补丁指纹），与内网第二级
    ASSEMBLY.md 并列；旧三行体 BUNDLE-INFO.txt 退役不残留。"""
    for wf in ("assemble-black-pool-bundle.yml", "assemble-black-pool-public.yml"):
        text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "BlackPool/BUILD.md" in text, f"{wf} 缺出厂清单烘制步"
        assert "sha256sum" in text and "GITHUB_SHA" in text, f"{wf} 清单缺指纹/commit"
        assert "BUNDLE-INFO" not in text, f"{wf} 旧 BUNDLE-INFO 残留"


def test_kill_by_path_noop_on_non_windows(tmp_path):
    """路径杀进程器：非 Windows 空跑退出 0（管线可验）；Windows 行为靠野战。"""
    r = subprocess.run([sys.executable, str(KIT / "kill_by_path.py"), str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "no-op" in r.stdout


def test_factory_cleanup_stubs_test_runner():
    """2026-08-04 野战回归（部署位跑 run_tests.sh 报 venv 缺 pytest）：整包既已
    裁掉 app/tests，就不得再留会撞 venv 探针的运行器原件——两条装配线出厂清场
    须 ① 裁 tests / tests-js ② 剔 run_tests_parallel.py ③ 把 run_tests.sh 换成
    直说「套件不随包」的存根（exit 2 + 指路 upstream/）。"""
    for wf in ("assemble-black-pool-bundle.yml", "assemble-black-pool-public.yml"):
        text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "rm -rf BlackPool/app/tests" in text, f"{wf} 未裁测试集"
        assert "rm -f BlackPool/app/scripts/run_tests_parallel.py" in text, (
            f"{wf} 未剔并行运行器"
        )
        assert "cat > BlackPool/app/scripts/run_tests.sh" in text, f"{wf} 缺运行器存根"
        assert "the test suite is not shipped" in text, f"{wf} 存根未直说真相"
        assert "projects/black-pool-agent/CONTEXT.md" in text, f"{wf} 存根未指路配方"

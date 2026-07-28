#!/usr/bin/env python3
"""合并前门禁 —— 把「CI 会跑什么」从凭记忆升格为算出来。

**为什么有这个脚本**（守密人 2026-07-27 裁定，产品审视 F3）：

§7.6 的判定门是「对话内跑全量测试，绿即合并，不围等 CI」。这条纪律的安全性完全
建立在一个假设上——**对话内跑的那些命令，覆盖了 CI 会红的全部原因**。实测这个假设
不成立：五个 required 检查里约 15 个门禁步骤是 `pytest` / `vitest` 跑不到的
（Typecheck / Build / Version-bump guard / conformance 棘轮 / Publishability /
依赖方向守卫）。2026-07-27 一小时内 main 因此红了两次——

- #835 手工跑了「依赖方向」「conformance 棘轮」，**漏了 version-bump guard**，
  合并后门禁在 main 上红了约一小时；
- #836 跑的是全量检出下的 pytest，CI 是稀疏检出，判词不同（见 `--sparse`）。

两次都不是「忘了跑测试」，是**没有任何东西说得清「该跑哪些」**。覆盖面每次会话
凭记忆临时决定，那就是弱约定——弱约定必然发散（同 §6.2 设 Public-Info-Pool 的根因）。

**做法**：清单不手写，从 `.github/workflows/*.yml` 里 required 检查对应的 job 派生。
加一个门禁步骤 = 改工作流一处，本脚本自动跟上；不存在第二份会漂移的清单
（同 `sdk-mutation-ratchet.yml` 的矩阵派生，提案招一「能生成就别对账」）。

唯一手写的是**五个 required 检查名**——GitHub 规则集的配置读不到（无相应 API 工具），
只能照 CLAUDE.md §7.6 抄。`tests/test_premerge_gate.py` 断言每个名字都解析得到真 job，
改名即红。

用法：
    python3 scripts/premerge_gate.py            # 跑全部可本地复现的门禁步骤
    python3 scripts/premerge_gate.py --list     # 只列清单，不跑
    python3 scripts/premerge_gate.py --with-setup   # 连 npm ci / 官方对照臂一起装
    python3 scripts/premerge_gate.py --sparse   # 另加：按 CI 的稀疏检出形态复跑 pytest

**跳过的步骤一律点名打印**：无声上限就是撒谎——一轮没跑的步骤必须被念出来，
否则日志读起来像「全跑了」。
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKFLOWS = REPO / ".github" / "workflows"

# GitHub 规则集的 required 检查名（CLAUDE.md §7.6；规则集配置本身无 API 可读，故此处手抄，
# 由 tests/test_premerge_gate.py 断言每个名字都能解析到真 job）。
REQUIRED_CHECKS = [
    "test",
    "Silver Core Agent SDK / unit tests",
    "Silver Core Agent SDK / conformance",
    "Silver Core Maestro SDK / unit + testbed",
    "Silver Core Maestro SDK / dependency direction",
]

# 三类不当作门禁跑的步骤。分类写死在这里而不是猜：
#   PLUMBING —— CI 管线步，产物是 $GITHUB_OUTPUT，本地无意义（且它只决定「跑不跑后面」，
#               本地一律全跑，正是它 fail-safe 的方向）。
#   SETUP    —— 装依赖。本地通常已装；`--with-setup` 才跑。
SETUP_MARKERS = ("npm ci", "npm install", "npm i ", "pip install")
PLUMBING_MARKERS = ("GITHUB_OUTPUT", "GITHUB_ENV")
# 未解析的 ${{ }} 表达式（除 github.workspace）无法本地执行——**响亮报告，绝不静默跳过**。
_EXPR = re.compile(r"\$\{\{\s*(?!\s*github\.workspace\s*\}\})[^}]*\}\}")


def _load(path: Path) -> dict:
    import yaml  # 延迟导入：--list 之外的路径才需要

    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _default_workdir(doc: dict, job: dict) -> str:
    """GitHub 的 `working-directory` 有三层，就近覆盖：工作流级 defaults → job 级
    defaults → 步骤级。

    **本脚本首跑就栽在这条上**：`silver-core-sdk.yml` 把 `working-directory:
    projects/silver-core-sdk` 写在**工作流顶层**，只读步骤级会让 `npm run typecheck`
    跑到仓根去，然后报一堆假红。派生清单的价值全在「与 CI 同解释」——解释错了，
    派生比手抄还坏，因为它看起来更权威。
    """
    for scope in (doc, job):
        wd = ((scope or {}).get("defaults") or {}).get("run", {}).get("working-directory")
        if wd:
            default = wd
    return locals().get("default", ".")


def _jobs_by_check_name() -> dict[str, tuple[Path, str, dict, str]]:
    """把 required 检查名映射到 (工作流档, job id, job 体, 继承来的 working-directory)。

    检查名 = job 的 `name`，没写 `name` 时 GitHub 用 job id——两种都认。
    """
    import yaml  # 同 _load 的延迟导入理由；异常收窄需要它在本作用域可见

    found: dict[str, tuple[Path, str, dict, str]] = {}
    for wf in sorted(WORKFLOWS.glob("*.yml")):
        try:
            doc = _load(wf)
        # 只挡「读不动 / YAML 语法坏」；解析器以外的异常必须冒出来
        except (OSError, UnicodeDecodeError, yaml.YAMLError):
            continue
        for jid, job in ((doc or {}).get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            label = job.get("name") or jid
            if label in REQUIRED_CHECKS and label not in found:
                found[label] = (wf, jid, job, _default_workdir(doc, job))
    return found


class Step:
    def __init__(self, check: str, name: str, run: str, workdir: str, kind: str):
        self.check, self.name, self.run, self.workdir, self.kind = check, name, run, workdir, kind

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Step {self.kind} {self.check}::{self.name}>"


def collect_steps() -> tuple[list[Step], list[str]]:
    """返回 (步骤表, 缺失的 required 检查名)。"""
    steps: list[Step] = []
    resolved = _jobs_by_check_name()
    missing = [c for c in REQUIRED_CHECKS if c not in resolved]
    for check in REQUIRED_CHECKS:
        if check not in resolved:
            continue
        _wf, _jid, job, inherited_wd = resolved[check]
        # 该 job 是否装了**仓外**的东西（`--no-save` 临时对照臂）。`npm ci` 只是把
        # package.json 里已有的装回来，本地通常已在；`npm i --no-save @anthropic-ai/...`
        # 装的是仓里根本没有的官方对照臂，**跳过它再跑差分不是「少跑一步」，是跑出假红**：
        # 实测缺臂时 conformance 棘轮报 58 条「回归」，而它们是环境固有（#835 已用同容器
        # A/B 证过改前改后都是 58）。假红比不跑更坏——它教人无视门禁。
        needs_arm = any("--no-save" in (s.get("run") or "") for s in (job.get("steps") or []))
        for st in job.get("steps") or []:
            run = st.get("run")
            if not run:
                continue
            name = st.get("name") or run.strip().splitlines()[0][:60]
            wd = str(st.get("working-directory") or inherited_wd).replace(
                "${{ github.workspace }}", "."
            )
            if any(m in run for m in PLUMBING_MARKERS):
                kind = "plumbing"
            elif any(m in run for m in SETUP_MARKERS):
                kind = "setup"
            elif _EXPR.search(run):
                kind = "unsupported"
            elif needs_arm:
                kind = "needs-arm"
            else:
                kind = "gate"
            steps.append(Step(check, name, run, wd, kind))
    return steps, missing


def _normalise(run: str) -> tuple[str, str | None]:
    """把命令调整到本机能跑，**并把每一处调整都说出来**。

    唯一一处调整：裸 `pytest` → `<本解释器> -m pytest`。CI 用 `pip install pytest
    pytest-cov` 把两者装在同一环境，本地 PATH 上的 `pytest` 可能是别的环境
    （本容器里是个 `uv tool` shim，没有 cov 插件），于是 CI 原样命令会以「无法识别
    --cov」退出 4——那是**环境差异冒充门禁失败**，会训练人无视门禁。

    调整只做这一处、且必须打印。默默改写命令等于伪造「与 CI 同解释」。
    """
    if re.match(r"^\s*pytest\s", run):
        try:
            probe = subprocess.run(["pytest", "--help"], capture_output=True, text=True, timeout=60)
            healthy = "--cov=" in probe.stdout
        except Exception:
            healthy = False
        if not healthy:
            return (re.sub(r"^(\s*)pytest\s", rf"\1{sys.executable} -m pytest ", run, count=1),
                    f"PATH 上的 pytest 不认 --cov（多半是另一环境的 shim），"
                    f"改用 {sys.executable} -m pytest")
    return run, None


# 「说了失败却退 0」的已知工具标记。退出码是本门禁判定通过与否的**唯一**依据，
# 而工具链会骗人：pytest 9.1.1 + pytest-cov 7.1.0 下 `--cov-fail-under` 打印
# 「FAIL Required test coverage of N% not reached」之后**退 0**，于是本门禁把它
# 判成通过——release 1.3.0（合并 686b8d5）就是这样带着 91.63% 的覆盖率过门的。
#
# 这正是本门禁自己要防的那类错（守卫报绿却什么都没查），所以这里不能只信退出码：
# 命中任一标记即判失败，无论退出码是多少。加新条目的门槛是「实测该工具确实会
# 打印失败判词却退 0」——不是凭印象往里塞正则。
SILENT_FAILURE_MARKERS = (
    "FAIL Required test coverage",
    "Coverage failure:",
)


def _run(step: Step) -> bool:
    cwd = (REPO / step.workdir).resolve()
    print(f"\n\033[1m▶ [{step.check}] {step.name}\033[0m  (cwd={step.workdir})")
    cmd, note = _normalise(step.run)
    if note:
        print(f"  \033[33m↺ 已调整：{note}\033[0m")
    # 边流式回显边留底：留底是为了扫上面那些标记，回显是为了长步骤不显得卡死。
    proc = subprocess.Popen(
        ["bash", "-euo", "pipefail", "-c", cmd], cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    captured: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        captured.append(line)
    proc.wait()
    tail = "".join(captured)

    ok = proc.returncode == 0
    if ok:
        hit = next((m for m in SILENT_FAILURE_MARKERS if m in tail), None)
        if hit is not None:
            ok = False
            print(f"  \033[31m⚠ 该步骤退出码为 0，但输出里有失败判词「{hit}」"
                  f"——按静默失败处理（工具退出码不可信，见 SILENT_FAILURE_MARKERS）\033[0m")
    print(f"  {'✓ 通过' if ok else f'✗ 失败 (exit {proc.returncode})'}")
    return ok


def sparse_selfcheck() -> bool:
    """按 CI 的稀疏检出形态复跑 Python 套件。

    第二类差集：**同一条命令、不同的检出形态，判词可以相反**。#836 正是如此——
    `test.yml` 排除 `/Public-Info-Pool/Record/` 与 `/Public-Info-Pool/Reference/`，
    本地全量检出跑绿的守卫在 CI 上红了两条。多跑几个步骤救不了这一类，只能复现形态。
    """
    work = Path("/tmp/premerge-sparse")
    if work.exists():
        subprocess.run(["git", "-C", str(REPO), "worktree", "remove", "--force", str(work)],
                       capture_output=True)
        shutil.rmtree(work, ignore_errors=True)
    print("\n\033[1m▶ [稀疏检出复现] 按 test.yml 的 sparse 模式跑 pytest\033[0m")
    # 这一腿跑的是 **HEAD**（worktree add 只检出已提交内容），而上面那 13 条门禁步骤跑的是
    # 工作树。树脏时两者测的不是同一份代码，而结尾却照打「✓ 稀疏检出下同样通过」——
    # 那句话就成了对**没测过的代码**的断言。尤其反讽的是：--sparse 存在的理由正是路径 /
    # 档案判据类改动，而这类改动没提交时恰恰一条也不在这一腿的射程内。故必须点名。
    dirty = subprocess.run(
        ["git", "-C", str(REPO), "status", "--porcelain"],
        capture_output=True, text=True, errors="replace",
    ).stdout.strip()
    if dirty:
        print(f"  \033[33m警告：工作树有 {len(dirty.splitlines())} 处未提交改动，本腿只覆盖 "
              f"HEAD——先提交，否则这一腿对你正要合并的改动一无所知。\033[0m")
    subprocess.run(["git", "-C", str(REPO), "worktree", "add", "--detach", str(work), "HEAD"],
                   check=True, capture_output=True)
    try:
        subprocess.run(
            ["git", "sparse-checkout", "set", "--no-cone", "/*",
             "!/Public-Info-Pool/Record/", "!/Public-Info-Pool/Reference/"],
            cwd=work, check=True, capture_output=True,
        )
        assert not (work / "Public-Info-Pool" / "Record").exists(), (
            "稀疏模式没生效——本检查会退化成又一次全量检出跑，等于没跑"
        )
        proc = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"], cwd=work)
        ok = proc.returncode == 0
        print(f"  {'✓ 稀疏检出下同样通过' if ok else '✗ 稀疏检出下失败——这正是 CI 会看到的'}")
        return ok
    finally:
        subprocess.run(["git", "-C", str(REPO), "worktree", "remove", "--force", str(work)],
                       capture_output=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="合并前门禁：跑齐 required 检查里的门禁步骤")
    ap.add_argument("--list", action="store_true", help="只列清单不执行")
    ap.add_argument("--with-setup", action="store_true", help="连依赖安装步骤一起跑")
    ap.add_argument("--sparse", action="store_true", help="另加按 CI 稀疏检出形态复跑 pytest")
    args = ap.parse_args()

    steps, missing = collect_steps()
    if missing:
        print(f"\033[31m致命：required 检查 {missing} 在工作流里找不到对应 job——"
              f"要么被改名、要么 REQUIRED_CHECKS 过期。先修这个，别跑。\033[0m")
        return 2

    # pre-push 钩子装配自检（2026-07-27 复核发现：新容器必漏 §7.4 的一次性
    # `git config core.hooksPath .githooks`，撞车防线在不知情中缺席——#850 与
    # #851 相隔 2 分钟落 main，靠 textual 合并碰巧干净过关）。警告不拦（CI 等
    # 无推送场景不适用），但必须被念出来。
    if (REPO / ".githooks").is_dir():
        hooks = subprocess.run(
            ["git", "config", "core.hooksPath"],
            cwd=REPO, capture_output=True, text=True,
        ).stdout.strip()
        if hooks != ".githooks":
            print("\033[33m警告：core.hooksPath 未指向 .githooks——pre-push 自动"
                  " rebase 防线不在场（§7.4：每个新克隆/容器跑一次 "
                  "`git config core.hooksPath .githooks`）。\033[0m")

    live = {"gate"} | ({"setup", "needs-arm"} if args.with_setup else set())
    runnable = [s for s in steps if s.kind in live]
    skipped = [s for s in steps if s not in runnable]

    print(f"required 检查 {len(REQUIRED_CHECKS)} 个，派生出门禁步骤 {len(steps)} 条"
          f"（本轮执行 {len(runnable)}，跳过 {len(skipped)}）")
    for s in steps:
        mark = "跑" if s in runnable else f"跳({s.kind})"
        print(f"  [{mark:>10}] {s.check} :: {s.name}")
    # 无声上限即撒谎：跳过的原因逐类点名。
    if any(s.kind == "unsupported" for s in skipped):
        print("\n\033[33m注意：以下步骤含未解析的 ${{ }} 表达式，本地无法复现——"
              "它们只有在 CI 上才被验证：\033[0m")
        for s in skipped:
            if s.kind == "unsupported":
                print(f"  - {s.check} :: {s.name}")
    if not args.with_setup and any(s.kind == "needs-arm" for s in skipped):
        print("\n\033[33m注意：以下步骤依赖 `--no-save` 临时装的仓外对照臂，缺臂跑会产出**假红**，"
              "故本轮跳过——它们只在 CI 上（或 --with-setup 时）被真正验证：\033[0m")
        for s in skipped:
            if s.kind == "needs-arm":
                print(f"  - {s.check} :: {s.name}")
    if not args.with_setup and any(s.kind == "setup" for s in skipped):
        print("\n提示：依赖安装步骤已跳过（假定本地已装）。要连装一起跑加 --with-setup。")

    if args.list:
        return 0

    failed = [s for s in runnable if not _run(s)]
    ok_sparse = sparse_selfcheck() if args.sparse else True

    print("\n" + "=" * 60)
    if failed or not ok_sparse:
        for s in failed:
            print(f"\033[31m✗ {s.check} :: {s.name}\033[0m")
        if not ok_sparse:
            print("\033[31m✗ 稀疏检出复现失败\033[0m")
        print("\033[31m合并前门禁未通过——不要合并。\033[0m")
        return 1
    print("\033[32m合并前门禁全部通过。\033[0m"
          + ("" if args.sparse else "（未跑稀疏检出复现，涉及路径/档案判据时加 --sparse）"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

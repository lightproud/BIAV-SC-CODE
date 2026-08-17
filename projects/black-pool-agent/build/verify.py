#!/usr/bin/env python3
"""周更闭环的两条验证腿（守密人 2026-08-16 裁定「进周更，假红自动排除」）。

例程闭环 = 追踪更新 → **测试①基底** → 审核补丁 → **测试②换装后** → 出 zip。
本模块提供中间那两条腿：

    base    上游自带 Python 套件跑**纯快照**（换装前）—— 答「新版本身好不好」
    net     桌面端回归网跑**打完补丁的组装树**（换装后）—— 答「我们的改装打坏它没有」

`net` 这条正是 2026-08-16 移 pin 首轮组装红的那一条（6 例红），当时它只活在
90 分钟的组装线里；挪进周更闭环后，同类问题在换装那一刻就报。

## 假红排除的纪律（这一段是本模块的良心，改代码前先读）

上游套件在银芯容器里有一批**环境 / 布局伪影**恒红（四簇分诊见
`Public-Info-Pool/Resource/repo-engineering/hermes-upstream-testrun-20260804.md`）。
自动排除它们是必要的，但排除方式**绝不用宽泛通配**——`approval` 这种裸词做模式，
会把将来任何带 approval 的真缺陷一并吞掉，那就成了「审核补丁」的反面。

故本模块只认**逐条具名的基线台账**（`upstream-false-reds.json`，每条含精确 nodeid /
所属簇 / 判为假红的理由 / 出处）：

- 失败 nodeid **在册** → 归为已知假红，计数排除，但**逐条点名打印**（排除不等于隐身）
- 失败 nodeid **不在册** → 一律视为**真缺陷候选**，响亮失败，例程停手交人工

台账只进不出靠人工裁定：上游修好了某条，它会从失败清单里消失，台账里那条便成死条目，
由 `--prune` 报出来供人清理——但**绝不自动增补新条目**，否则「自动排除」会退化成
「自动无视」，本周红的那 6 例正是靠「没人自动无视它」才被抓住的。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB = HERE.parent
REPO = SUB.parent.parent
UPSTREAM = SUB / "upstream"
FALSE_REDS = HERE / "upstream-false-reds.json"

UV_VERSION = "0.9.28"          # 上游 tests.yml 钉版（与组装线 env 同源）
PYTHON_VERSION = "3.11"
# 九 extra 口径，逐字取自 testrun-20260804「复现口径」表，改动须同步该报告
SUITE_EXTRAS = ["all", "dev", "anthropic", "mistral", "fal", "modal",
                "daytona", "hindsight", "parallel-web"]
# astral.sh 安装脚本被银芯出网代理 403（同报告实证），改 GitHub Releases 直下二进制
UV_URL = (f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}"
          "/uv-x86_64-unknown-linux-gnu.tar.gz")

# pytest 短摘要行：`FAILED tests/x.py::test_y - AssertionError: ...`
NODEID_RE = re.compile(r"^(FAILED|ERROR)\s+(\S+)", re.M)


class VerifyError(Exception):
    """验证腿的前置条件不成立——响亮失败，绝不「跑不动就当绿」。"""


def _run(cmd, cwd=None, env=None, timeout=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True,
                       timeout=timeout, errors="replace")
    if check and r.returncode != 0:
        raise VerifyError(f"命令失败 {' '.join(map(str, cmd[:3]))}: "
                          f"{(r.stderr or r.stdout)[-800:]}")
    return r


# ---------------------------------------------------------------- 假红台账


def load_false_reds() -> dict:
    """读假红台账。**缺档或空档不是错误，是「尚无排除依据」**。

    引导期（台账还空着）必须走「全部失败按真缺陷候选报」这条路，而不是报错跑不动，
    更不是默默放行：首跑把真实失败清单摆出来，人工按四簇归类后逐条入册，
    台账才有内容。这是棘轮的起手式，不是缺陷。
    """
    if not FALSE_REDS.exists():
        return {}
    data = json.loads(FALSE_REDS.read_text(encoding="utf-8"))
    return {e["nodeid"]: e for e in data.get("entries", [])}


def triage(nodeids: list[str]) -> dict:
    """把失败清单切成「在册假红」与「真缺陷候选」两堆。

    在册者逐条点名回传（供报告打印），不在册者即例程停手的理由。
    """
    known_map = load_false_reds()
    known, unknown = [], []
    for nid in nodeids:
        entry = known_map.get(nid)
        (known if entry else unknown).append(entry or {"nodeid": nid})
    hit = {e["nodeid"] for e in known}
    stale = [n for n in known_map if n not in hit]
    return {"known": known, "unknown": unknown, "stale": stale}


def parse_failures(log_text: str) -> list[str]:
    """从运行器输出里抓失败 nodeid（pytest 短摘要行）。

    去重并排序：同一档的 pytest 输出会被运行器复述一次（Failure output 段），
    不去重会把条数虚报成两倍。
    """
    return sorted({m.group(2) for m in NODEID_RE.finditer(log_text)})


def parse_counts(log_text: str) -> dict:
    """抓运行器尾部的规模数字，用于报告——**不用于判定通过与否**。

    判定一律以「失败清单是否只剩在册假红」为准：数字对不上只说明解析漂了，
    而解析漂的正确反应是响亮失败，不是拿数字当结论。
    """
    out = {}
    m = re.search(r"===\s+(\d+)\s+files? with test failures \((\d+) tests? failed\)", log_text)
    if m:
        out["failed_files"], out["failed_tests"] = int(m.group(1)), int(m.group(2))
    m = re.search(r"===\s+(\d+)\s+files? where no tests ran", log_text)
    if m:
        out["no_tests_files"] = int(m.group(1))
    passed = sum(int(x) for x in re.findall(r"^\s*\d+\s+passed", log_text, re.M) or [])
    if passed:
        out["passed_lines_sum"] = passed
    return out


# ---------------------------------------------------------------- 基底体检


def ensure_uv(work: Path) -> Path:
    """取钉版 uv 二进制（仓外），已在就复用。"""
    dest = work / "uv" / "uv-x86_64-unknown-linux-gnu" / "uv"
    if dest.exists():
        return dest
    (work / "uv").mkdir(parents=True, exist_ok=True)
    tar = work / "uv" / "uv.tar.gz"
    _run(["curl", "-sSL", "-o", str(tar), UV_URL], timeout=600)
    _run(["tar", "xzf", str(tar)], cwd=work / "uv")
    if not dest.exists():
        raise VerifyError(f"uv 解包后不在预期位置: {dest}")
    return dest


def suite_env(work: Path, uv: Path) -> dict:
    """套件运行环境：venv 与缓存一律落仓外（快照树零污染，UPSTREAM.md 纪律）。"""
    env = dict(os.environ)
    env.update({
        "UV_PROJECT_ENVIRONMENT": str(work / "venv"),
        "UV_CACHE_DIR": str(work / "cache"),
        "PATH": f"{uv.parent}{os.pathsep}{env.get('PATH', '')}",
        # 0.20 起运行器只认树内 .venv 或本变量，venv 落仓外时必设（缺则拒跑）
        "HERMES_PYTHON": str(work / "venv" / "bin" / "python"),
        # 防真调用外部 API
        "OPENROUTER_API_KEY": "",
        "OPENAI_API_KEY": "",
    })
    return env


def run_base_suite(work: Path, jobs: int = 4, timeout: int = 5400) -> dict:
    """测试①：上游自带套件跑**纯快照**（换装前的基底体检）。

    跑的是 `upstream/` 本体——刻意不复制到别处：这一条答的是「上游这个新版
    自己健不健康」，正该在未经我们改装的树上测。跑完清生成物（`.pyc` 会被
    `git add -f` 强推，2026-08-02 曾因此触发 GitHub 推送保护拒推）。
    """
    work.mkdir(parents=True, exist_ok=True)
    uv = ensure_uv(work)
    env = suite_env(work, uv)

    t0 = time.time()
    _run([str(uv), "sync", "--locked", "--python", PYTHON_VERSION,
          *sum([["--extra", e] for e in SUITE_EXTRAS], [])],
         cwd=UPSTREAM, env=env, timeout=2400)
    sync_s = time.time() - t0

    t1 = time.time()
    # --file-timeout 必给：单档挂死会把整跑吊在那里不动（2026-08-17 实测一次，
    # 日志六小时零增长）。宁可让那一档超时报红，也不要整条腿静默悬停。
    r = _run(["bash", "scripts/run_tests.sh", "-j", str(jobs), "--file-timeout", "600"],
             cwd=UPSTREAM, env=env, timeout=timeout, check=False)
    log = r.stdout + r.stderr
    (work / "base-suite.log").write_text(log, encoding="utf-8")
    clean_pyc(UPSTREAM)

    failures = parse_failures(log)
    verdict = triage(failures)
    ledger_empty = not FALSE_REDS.exists() or not load_false_reds()
    return {
        "leg": "base",
        "ledger_bootstrapping": ledger_empty,
        "tree": "upstream/（纯快照，未换装）",
        "exit_code": r.returncode,
        "sync_seconds": round(sync_s),
        "run_seconds": round(time.time() - t1),
        "counts": parse_counts(log),
        "failures": failures,
        **verdict,
        "log": str(work / "base-suite.log"),
        # 通过 = 失败清单里没有台账外的条目。退出码非零但全是在册假红，照样算过——
        # 这正是「假红自动排除」的含义；反之台账外只要有一条，无论退出码都不算过。
        "passed": not verdict["unknown"],
    }


def clean_pyc(root: Path) -> None:
    for d in list(root.rglob("__pycache__")):
        shutil.rmtree(d, ignore_errors=True)
    for f in list(root.rglob("*.pyc")):
        f.unlink(missing_ok=True)


# ---------------------------------------------------------------- 换装后网


def run_desktop_net(work: Path, timeout: int = 2700) -> dict:
    """测试②：桌面端回归网跑**打完补丁的组装树**（换装后）。

    与组装线 `regression-net` job 同源同序：换装（私有版）→ 特性补丁 → npm ci → vitest。
    组装树落仓外临时目录——绝不在 `upstream/` 上就地打补丁（快照零修改红线）。
    """
    work.mkdir(parents=True, exist_ok=True)
    tree = work / "net" / "app"
    if tree.parent.exists():
        shutil.rmtree(tree.parent)
    tree.parent.mkdir(parents=True)
    shutil.copytree(UPSTREAM, tree, symlinks=False,
                    ignore=shutil.ignore_patterns(".venv", "node_modules", "__pycache__"))

    _run([sys.executable, str(HERE / "rebrand.py"), "--apply", str(tree)])
    _run(["git", "apply", str(SUB / "patches" / "conversation-cost-panel.patch")], cwd=tree)

    desktop = tree / "apps" / "desktop"
    t0 = time.time()
    _run(["npm", "ci"], cwd=desktop, timeout=1800)
    r = _run(["npx", "vitest", "run"], cwd=desktop, timeout=timeout, check=False)
    log = r.stdout + r.stderr
    (work / "desktop-net.log").write_text(log, encoding="utf-8")

    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?", log)
    counts = {}
    if m:
        counts = {"failed": int(m.group(1) or 0), "passed": int(m.group(2)),
                  "skipped": int(m.group(3) or 0)}
    elif r.returncode == 0:
        # 退出码 0 却解析不出计数 = 解析漂了，不许当绿（vitest 换了输出形态即在此报）
        raise VerifyError("桌面端回归网退出码 0 但读不出计数——输出形态变了，先修解析再信结论")

    failed = [l.strip() for l in log.splitlines() if l.strip().startswith("FAIL ")]
    return {
        "leg": "desktop-net",
        "tree": "组装树（私有版换装 + 特性补丁）",
        "exit_code": r.returncode,
        "run_seconds": round(time.time() - t0),
        "counts": counts,
        "failures": sorted(set(failed))[:40],
        "log": str(work / "desktop-net.log"),
        "passed": r.returncode == 0,
    }


# ---------------------------------------------------------------- 报告渲染


def render(result: dict) -> str:
    """把一条腿的结论渲染成人读段落（进公告 / 会话汇报两用）。"""
    head = {"base": "测试① 基底体检（上游套件 · 纯快照）",
            "desktop-net": "测试② 换装后回归网（桌面端 · 组装树）"}[result["leg"]]
    mark = "通过" if result["passed"] else "**未通过**"
    lines = [f"### {head} —— {mark}", ""]
    c = result.get("counts") or {}
    if result["leg"] == "base":
        lines.append(f"- 用时：依赖同步 {result['sync_seconds']}s + 跑测 {result['run_seconds']}s")
        lines.append(f"- 失败条目 {len(result['failures'])} 条 —— "
                     f"在册假红 {len(result['known'])} 条，台账外 {len(result['unknown'])} 条")
        if result["known"]:
            lines += ["", "已知环境假红（逐条点名，排除不等于隐身）：", ""]
            by_cluster: dict[str, list] = {}
            for e in result["known"]:
                by_cluster.setdefault(e.get("cluster", "未归簇"), []).append(e["nodeid"])
            for cluster, ids in sorted(by_cluster.items()):
                lines.append(f"- **{cluster}**（{len(ids)} 条）")
        if result["unknown"]:
            lines += ["", "**台账外失败（视为真缺陷候选，例程停手）**：", ""]
            lines += [f"- `{e['nodeid']}`" for e in result["unknown"][:30]]
        if result.get("stale"):
            lines += ["", f"> 台账死条目 {len(result['stale'])} 条（上游可能已修，供人工清理）："
                          f" {', '.join(result['stale'][:5])}"]
    else:
        lines.append(f"- 用时：{result['run_seconds']}s")
        if c:
            lines.append(f"- {c.get('passed', 0)} 过 / {c.get('failed', 0)} 红 / "
                         f"{c.get('skipped', 0)} 跳过")
        if result["failures"]:
            lines += ["", "失败档："] + [f"- `{f}`" for f in result["failures"][:20]]
    lines.append("")
    return "\n".join(lines)

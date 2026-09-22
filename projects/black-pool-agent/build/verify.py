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

## 两条腿各管各的册（2026-09-18 守密人裁定后）

`base` 认 `upstream-false-reds.json`（纯快照上的环境假红），`net` 认
`desktop-env-gaps.json`（换装树上的已知环境缺口，入册须带守密人裁定日期）。
**绝不共用一张免死金牌**：一条腿的排除依据拿到另一条腿上就成了无依据放行。
`net` 的放行还多三道旁证（用例级 / 无整档崩 / 解析计数逐个对上），见
`evaluate_desktop_net`。
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
DESKTOP_GAPS = HERE / "desktop-env-gaps.json"

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
# vitest 失败行：` FAIL  src/x.test.ts > describe > case`（用例级带 " > "，整档崩不带）
VITEST_FAIL_RE = re.compile(r"^\s*FAIL\s+(\S.*?)\s*$", re.M)
CASE_SEP = " > "
# CI 上 vitest 照样上色，FAIL 行以转义序列开头 —— 不剥就一条也抓不到（2026-09-21 实证：
# 组装线 run 35606424068 因此把在册两条读成「台账死条目」、计数也读不出，闸门按纪律停手）。
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# 同一条用例在两种输出形态下的前缀不同：无色是 `|ui| path > case`，彩色剥离后是
# `ui  path > case`。nodeid 必须跨环境唯一，故解析期一律剥掉 project 标签，只留
# `path > case`——台账也按这个形态登记。
PROJECT_TAG_RE = re.compile(
    r"^(?:\|[\w.-]+\||[\w.-]+)\s+(?=\S*\.(?:test|spec)\.[\w]+)")
# vitest 汇总行（剥色后再匹配）
VITEST_COUNTS_RE = re.compile(
    r"Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?")


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


def load_desktop_gaps() -> dict:
    """读换装后回归网的「已知环境缺口」台账（守密人 2026-09-18 裁定的受控豁免口）。

    缺档 = 一条也不豁免（回到纯二元闸门），**不是**错误——这是安全的缺省方向。
    有档则逐条查验字段完备：缺 reason / source / decided_on / decided_by 任一即
    **响亮失败**。豁免是拿守密人的裁定换来的，没有裁定出处的条目一条也不许放行。
    整档崩不可豁免，故 nodeid 必须是用例级（含 " > "），文件级条目一律拒收。
    """
    if not DESKTOP_GAPS.exists():
        return {}
    data = json.loads(DESKTOP_GAPS.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for e in data.get("entries", []):
        nid = e.get("nodeid", "")
        for field in ("nodeid", "reason", "source", "decided_on", "decided_by"):
            if not e.get(field):
                raise VerifyError(
                    f"环境缺口台账条目缺 {field}（nodeid={nid or '<空>'}）："
                    "无裁定出处的条目不许放行，先补齐或删条目")
        if CASE_SEP not in nid:
            raise VerifyError(
                f"环境缺口台账条目非用例级（nodeid={nid}）：整档崩不可豁免，"
                f"nodeid 必须含 {CASE_SEP!r}")
        out[nid] = e
    return out


def strip_ansi(text: str) -> str:
    """剥掉 ANSI 转义序列。CI 与本地的着色行为不同，nodeid 却必须是同一个。"""
    return ANSI_RE.sub("", text)


def parse_vitest_counts(log_text: str) -> dict:
    """抓 vitest 尾部汇总计数（两条腿与 CI 入口**共用这一个实现**，别再各写各的）。

    读不出就回空字典——判定层据此认定「解析漂了」，而解析漂的正确反应是不放行。
    """
    m = VITEST_COUNTS_RE.search(strip_ansi(log_text))
    if not m:
        return {}
    return {"failed": int(m.group(1) or 0), "passed": int(m.group(2)),
            "skipped": int(m.group(3) or 0)}


def parse_vitest_failures(log_text: str) -> list[str]:
    """从 vitest 输出里抓失败条目，规范成 nodeid。

    规范化三步：剥 ANSI → 去 "FAIL " 前缀 → 去 project 标签（`|ui| ` / `ui  `），
    再收敛空白。这样无色（本地）与彩色（CI）两种输出落到**同一个 nodeid**，
    台账才对得上。用例级形如 `src/x.test.ts > describe > case`，整档崩则只有档路径；
    两者都抓——**区分交给调用方**，解析层不替判定层做取舍。
    """
    out = set()
    for m in VITEST_FAIL_RE.finditer(strip_ansi(log_text)):
        nid = " ".join(m.group(1).split())
        nid = PROJECT_TAG_RE.sub("", nid).strip()
        if nid:
            out.add(nid)
    return sorted(out)


def triage(nodeids: list[str], known_map: dict | None = None) -> dict:
    """把失败清单切成「在册（假红 / 已知环境缺口）」与「真缺陷候选」两堆。

    在册者逐条点名回传（供报告打印），不在册者即例程停手的理由。
    `known_map` 缺省取基底体检的假红台账；换装后回归网传自己的环境缺口台账进来——
    两条腿**各管各的册**，绝不共用一张免死金牌。
    """
    known_map = load_false_reds() if known_map is None else known_map
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


def evaluate_desktop_net(returncode: int, counts: dict, failures: list[str],
                         known_map: dict | None = None, build_ok: bool = True) -> dict:
    """换装后回归网的判定（守密人 2026-09-18 裁定的受控豁免闸门）。

    抽成纯函数是为了**能被单测直接拷问**——闸门松没松，不该等到真跑一遍 45 分钟的
    vitest 才知道。判定输入只有四样：退出码 / vitest 汇总计数 / 失败清单 / 台账。

    红了仍放行，必须**四条同时成立**，缺一即停手。刻意设得比「全部在册」更严：

      ① 失败清单全部在册（台账外一条都没有）——台账外失败一律真缺陷候选
      ② 确有用例级失败（红着却抓不出条目 = 说不清是什么红，不放行）
      ③ 无整档崩（那是组装树坏了，不是某条用例撞环境，不可豁免）
      ④ 解析出的用例级条数与 vitest 汇总 failed 计数**逐个对上**——对不上说明解析漂了，
        而解析漂的正确反应是不放行（同 parse_counts 的纪律：数字对不上不是结论，是警报）

    另有一条**先决条件**：构建腿（`npm run build`）必须过。它不在四条之列，因为它根本
    不参与豁免——构建塌了就是塌了，台账管不着（守密人 2026-09-21 裁定纳入回归网）。
    """
    if known_map is None:
        known_map = load_desktop_gaps()
    case_level = [n for n in failures if CASE_SEP in n]
    file_level = [n for n in failures if CASE_SEP not in n]
    verdict = triage(failures, known_map)
    parse_consistent = bool(counts) and counts.get("failed", -1) == len(case_level)
    gated = bool(returncode != 0 and not verdict["unknown"] and case_level
                 and not file_level and parse_consistent)
    return {
        "build_ok": build_ok,
        "exit_code": returncode,
        "counts": counts,
        "failures": failures[:40],
        "known": verdict["known"],
        "unknown": verdict["unknown"],
        "stale": verdict["stale"],
        "file_level_failures": file_level,
        "parse_consistent": parse_consistent,
        "gated": gated,
        "passed": build_ok and (returncode == 0 or gated),
    }


def run_desktop_build(desktop: Path, timeout: int = 1800) -> dict:
    """构建腿（守密人 2026-09-21 裁定纳入回归网）：在组装树上真跑 `npm run build`。

    为什么必须有：vitest 跑的是模块图里被测到的那部分，打包器的模块解析是另一回事——
    2026-09-21 实测，上游把 `compactNumber` 挪进共享包后，特性补丁的导入失效，
    vitest 全绿而 `vite build` 报 `UNLOADABLE_DEPENDENCY`，红只能等到 windows 打包段
    才暴露，一轮组装 45–75 分钟就这么耗掉。本地实测构建约 36 秒，换这个提前量很划算。

    **构建失败不可豁免**：环境缺口台账只管 vitest 的用例级失败，构建塌了说明这棵树
    根本装不出来，没有「在册」一说。
    """
    t0 = time.time()
    r = _run(["npm", "run", "build"], cwd=desktop, timeout=timeout, check=False)
    log = r.stdout + r.stderr
    return {"passed": r.returncode == 0, "exit_code": r.returncode,
            "seconds": round(time.time() - t0), "tail": log[-1500:] if r.returncode else ""}


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
    # 构建腿先跑：它快（约 36 秒）且塌了就没必要再等十几分钟的 vitest
    build = run_desktop_build(desktop)
    r = _run(["npx", "vitest", "run"], cwd=desktop, timeout=timeout, check=False)
    log = r.stdout + r.stderr
    (work / "desktop-net.log").write_text(log, encoding="utf-8")

    counts = parse_vitest_counts(log)
    if not counts and r.returncode == 0:
        # 退出码 0 却解析不出计数 = 解析漂了，不许当绿（vitest 换了输出形态即在此报）
        raise VerifyError("桌面端回归网退出码 0 但读不出计数——输出形态变了，先修解析再信结论")

    failures = parse_vitest_failures(log)
    return {
        "leg": "desktop-net",
        "tree": "组装树（私有版换装 + 特性补丁）",
        "run_seconds": round(time.time() - t0),
        "log": str(work / "desktop-net.log"),
        "build": build,
        **evaluate_desktop_net(r.returncode, counts, failures, build_ok=build["passed"]),
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
        b = result.get("build") or {}
        if b:
            lines.append(f"- 构建腿 `npm run build`：{'通过' if b.get('passed') else '**未通过**'}"
                         f"（{b.get('seconds', 0)}s）")
        elif result.get("build_ok") is False:
            lines.append("- 构建腿 `npm run build`：**未通过**")
        if result.get("build_ok") is False:
            lines.append("- 构建塌了即整条未过，**不可豁免**（台账只管 vitest 的用例级失败）")
        if c:
            lines.append(f"- {c.get('passed', 0)} 过 / {c.get('failed', 0)} 红 / "
                         f"{c.get('skipped', 0)} 跳过")
        if result.get("gated"):
            lines.append("- 退出码非零，但失败清单全部在「已知环境缺口」台账内，闸门放行")
        if result.get("known"):
            lines += ["", "已知环境缺口（逐条点名，豁免不等于隐身）：", ""]
            for e in result["known"]:
                lines.append(f"- `{e['nodeid']}` —— {e.get('reason', '')}"
                             f"（{e.get('decided_on', '')} 守密人裁定）")
        if result.get("unknown"):
            lines += ["", "**台账外失败（视为真缺陷候选，例程停手）**：", ""]
            lines += [f"- `{e['nodeid']}`" for e in result["unknown"][:20]]
        if result.get("file_level_failures"):
            lines += ["", "**整档崩（不可豁免）**：", ""]
            lines += [f"- `{f}`" for f in result["file_level_failures"][:10]]
        if result.get("stale"):
            lines += ["", f"> 台账死条目 {len(result['stale'])} 条（环境或上游可能已修，"
                          f"供人工清理）：{', '.join(result['stale'][:5])}"]
        if not result.get("known") and result["failures"]:
            lines += ["", "失败档："] + [f"- `{f}`" for f in result["failures"][:20]]
    lines.append("")
    return "\n".join(lines)

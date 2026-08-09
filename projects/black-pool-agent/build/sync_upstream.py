#!/usr/bin/env python3
"""Hermes 上游周更同步引擎（守密人 2026-08-09 四项裁定的机械腿）。

定位：把 `UPSTREAM.md`「同步例程」四步从**凭记忆手敲**升格为**算出来**。
本脚本只干确定性的活，一步不越界——

    probe      探上游最新 release tag，与台账 pin 比对，报「要不要动」
    sync       换快照 + 同步版本常量 + 重生成品牌补丁 + 核对特性补丁 + 改台账
    changelog  取两 pin 之间的提交史，按约定式提交分类，标出撞补丁面的高风险条目
    announce   据同步报告渲染「更新公告 + zip 链接 + BPA 更新指南」落档

**不干**的活（刻意留给周更例程会话，见 `WEEKLY-UPDATE.md`）：
git 提交 / 推送 / 触发组装线 / 特性补丁人工重放 / 公告正文的人话润色。

为什么不用 GitHub API：银芯会话与 CI 的出网走代理，`api.github.com` 仅对本仓授权，
对 `NousResearch/hermes-agent` 一律 403；git 协议则畅通（实测 `--filter=tree:0`
全量提交史 18MB / 1.85 秒）。故**一切上游事实经 git 取**，API 不进这条链路。

退出码（例程会话据此分流，别改语义）：
    0  成功（含「已是最新、无事可做」）
    2  用法/环境错误
    3  **特性补丁在新基底上冲突** —— 需人工重放，非脚本能自愈
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB = HERE.parent                       # projects/black-pool-agent
REPO = SUB.parent.parent                # 仓根
UPSTREAM = SUB / "upstream"
UPSTREAM_MD = SUB / "UPSTREAM.md"
REBRAND = HERE / "rebrand.py"
CHARTER_TEST = REPO / "tests" / "test_hermes_charter.py"

UPSTREAM_URL = "https://github.com/NousResearch/hermes-agent.git"

# 规则引擎产的两张补丁由 rebrand.py 全权重出，不参与「人工重放」判定；
# 其余补丁一律视为**手维护特性补丁**，移 pin 后须逐张核对新基底。
GENERATED_PATCHES = {"black-pool-rebrand.patch", "black-pool-intranet.patch"}

# 上游 tag 形态 vYYYY.M.D[.N]。只认这一种——认不出的 tag 宁可漏也不错点成 pin。
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$")

BEIJING = timezone(timedelta(hours=8))


class SyncError(Exception):
    """前置条件不成立——响亮失败，绝不「尽力而为」地半同步。"""


def today() -> str:
    """北京时间日期（CLAUDE.md §2.1.4 时间基准）。"""
    return datetime.now(BEIJING).strftime("%Y-%m-%d")


def rel(p: Path) -> str:
    """仓内路径给相对形态，仓外的原样返回——不为了好看而在越界时抛异常。"""
    try:
        return str(p.relative_to(REPO))
    except ValueError:
        return str(p)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SyncError(f"命令失败 {' '.join(cmd[:4])}...: {(r.stderr or r.stdout)[:600]}")
    return r


# ---------------------------------------------------------------- 台账读写


def read_pin(text: str | None = None) -> dict:
    """从 UPSTREAM.md 解析当前 pin。台账是唯一权威，这里只读不猜。"""
    text = UPSTREAM_MD.read_text(encoding="utf-8") if text is None else text
    m = re.search(
        r"^\|\s*pin tag\s*\|\s*\*\*`(?P<tag>[^`]+)`\*\*"
        r"（commit `(?P<sha>[0-9a-f]{7,40})`，(?P<date>[\d-]+)，引擎版本 (?P<engine>[\d.]+)）\s*\|",
        text, re.M,
    )
    if not m:
        raise SyncError("UPSTREAM.md 的 pin 行读不出——台账被改过形态，先修台账再跑同步")
    return {k: m.group(k) for k in ("tag", "sha", "date", "engine")}


def write_pin(*, tag: str, sha: str, tag_date: str, engine: str,
              files: int, size: str, note: str) -> None:
    """改写「当前 pin」表 + 向「移 pin 史」表追加一行。

    两处都是机器所有区：格式对不上即抛，不做模糊匹配——台账写歪比不写更坏。
    """
    text = UPSTREAM_MD.read_text(encoding="utf-8")

    # 行尾一律用 [ \t]*$ 而非 \s*$：\s 会连着换行把下一个空行一起吃掉，
    # 表和后续小标题当场粘成一坨（2026-08-09 彩排实测）。
    pin_row = (f"| pin tag | **`{tag}`**（commit `{sha}`，{tag_date}，"
               f"引擎版本 {engine}） |")
    text, n = re.subn(r"^\|[ \t]*pin tag[ \t]*\|.*\|[ \t]*$", pin_row.replace("\\", "\\\\"),
                      text, count=1, flags=re.M)
    if n != 1:
        raise SyncError("pin 行改写失败")

    text, n = re.subn(r"^\|[ \t]*快照规模[ \t]*\|.*\|[ \t]*$",
                      f"| 快照规模 | {files:,} 文件 / {size} |", text, count=1, flags=re.M)
    if n != 1:
        raise SyncError("快照规模行改写失败")

    text, n = re.subn(r"^\|[ \t]*入仓日[ \t]*\|.*\|[ \t]*$",
                      f"| 入仓日 | {today()} |", text, count=1, flags=re.M)
    if n != 1:
        raise SyncError("入仓日行改写失败")

    # 移 pin 史：机器只在表尾追加，不改既有行（人工补注写在备注列里，不会被覆盖）
    hist = re.search(r"(?P<head>^## 移 pin 史\b.*?\n\|[^\n]*\|\n\|[-| ]*\|\n)"
                     r"(?P<rows>(?:\|[^\n]*\|\n)*)", text, re.M | re.S)
    if not hist:
        raise SyncError("移 pin 史表缺失或形态不符——机器追加区不在了")
    row = f"| {today()} | `{tag}` | {engine} | {note} |\n"
    text = text[:hist.end("rows")] + row + text[hist.end("rows"):]

    UPSTREAM_MD.write_text(text, encoding="utf-8")


def sync_version_constants(engine: str) -> list[str]:
    """把上游引擎版本同步进两处硬编码点（`UPSTREAM.md` 例程步 3 的前半句）。

    这两处漏改是移 pin 的经典静默坑：About 出身行会挂着上一版号继续渲染，
    补丁照样干净应用、守卫照样绿，穿帮要等用户点开关于页。
    """
    touched = []

    src = REBRAND.read_text(encoding="utf-8")
    new, n = re.subn(r'^(UPSTREAM_VERSION = ")[\d.]+(")', rf"\g<1>{engine}\g<2>",
                     src, count=1, flags=re.M)
    if n != 1:
        raise SyncError("rebrand.py 的 UPSTREAM_VERSION 常量找不到")
    if new != src:
        REBRAND.write_text(new, encoding="utf-8")
        touched.append(rel(REBRAND))

    src = CHARTER_TEST.read_text(encoding="utf-8")
    new, n = re.subn(r"(基于 Hermes Agent )[\d.]+( 定制)", rf"\g<1>{engine}\g<2>", src)
    if n < 1:
        raise SyncError("test_hermes_charter.py 的出身行哨兵找不到")
    if new != src:
        CHARTER_TEST.write_text(new, encoding="utf-8")
        touched.append(rel(CHARTER_TEST))

    return touched


# ---------------------------------------------------------------- 上游探测


def list_tags() -> list[tuple[tuple[int, ...], str]]:
    r = run(["git", "ls-remote", "--tags", "--refs", UPSTREAM_URL])
    out = []
    for line in r.stdout.splitlines():
        _, _, ref = line.partition("\t")
        name = ref.rsplit("/", 1)[-1]
        m = TAG_RE.match(name)
        if m:
            out.append((tuple(int(g) for g in m.groups() if g is not None), name))
    if not out:
        raise SyncError("上游一个可识别 tag 都没探到——先查网络/代理，别当成「没更新」")
    return sorted(out)


def latest_tag() -> str:
    return list_tags()[-1][1]


def probe() -> dict:
    pin = read_pin()
    latest = latest_tag()
    return {
        "current_tag": pin["tag"],
        "current_sha": pin["sha"],
        "current_engine": pin["engine"],
        "latest_tag": latest,
        "needs_update": latest != pin["tag"],
        "checked_at": datetime.now(BEIJING).isoformat(timespec="seconds"),
    }


# ---------------------------------------------------------------- 变更史


BUCKETS = [
    ("feat", "新增能力"),
    ("fix", "缺陷修复"),
    ("perf", "性能"),
    ("refactor", "重构"),
    ("build", "构建/依赖"),
    ("ci", "CI"),
    ("test", "测试"),
    ("docs", "文档"),
    ("style", "样式"),
    ("chore", "杂务"),
    ("revert", "回退"),
    ("other", "未分类"),
]

def patch_target_files() -> dict[str, set[str]]:
    """每张补丁要打的文件集（路径相对 upstream 根，与上游提交的路径同坐标系）。

    这是「高风险」判定的**地面真相**：上游动了我们补丁要打的文件 = 真撞面；
    没动 = 不管标题多吓人都不撞。早期版本用关键词猜，945 提交里报出 257 条
    高风险（27%），等于没报——`test(...)` 里一个 "update" 就中招。
    """
    out = {}
    for p in sorted((SUB / "patches").glob("*.patch")):
        files = set()
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^diff --git a/(.+?) b/", line)
            if m:
                files.add(m.group(1))
        out[p.name] = files
    return out


def commit_log(from_sha: str, to_ref: str, work: Path) -> list[dict]:
    """取两 pin 之间的提交史（含每个提交动了哪些文件）。

    克隆只要提交与树、不要 blob（`--filter=blob:none` + `--bare`）——
    上游 20,095 提交实测 46MB / 4.0 秒，`git log --name-only` 秒回；
    换全量克隆是 422MB。文件名单是撞补丁面判定的原料，不能省。
    """
    mirror = work / "hermes-log"
    if not mirror.exists():
        run(["git", "clone", "--filter=blob:none", "--no-checkout", "--bare",
             UPSTREAM_URL, str(mirror)])
    # %x00 作提交分隔（提交信息里不可能出现 NUL），组内首行是元数据、其余是文件名
    r = run(["git", "log", "--name-only", "--no-renames",
             "--pretty=format:%x00%H%x1f%s%x1f%an%x1f%cs", f"{from_sha}..{to_ref}"], cwd=mirror)
    commits = []
    for chunk in r.stdout.split("\x00"):
        if not chunk.strip():
            continue
        head, _, rest = chunk.partition("\n")
        parts = head.split("\x1f")
        if len(parts) != 4:
            continue
        sha, subject, author, date = parts
        m = re.match(r"^(?P<kind>[a-z]+)(?:\((?P<scope>[^)]*)\))?!?:\s*(?P<rest>.*)$", subject)
        kind = m.group("kind") if m else ("revert" if subject.lower().startswith("revert") else "other")
        if kind not in dict(BUCKETS):
            kind = "other"
        commits.append({
            "sha": sha[:8], "subject": subject, "author": author, "date": date,
            "kind": kind, "scope": (m.group("scope") if m else None) or "",
            "files": [f for f in rest.splitlines() if f.strip()],
        })
    return commits


def changelog_markdown(commits: list[dict], *, from_tag: str, to_tag: str) -> str:
    """按桶渲染变更清单。

    展开策略：feat / fix / perf / revert 逐条列（用户能感知的面），
    其余只报条数——周更动辄数百提交，全列等于没列。
    """
    counts = {k: 0 for k, _ in BUCKETS}
    for c in commits:
        counts[c["kind"]] += 1

    lines = [f"上游区间 `{from_tag}` → `{to_tag}`，共 **{len(commits)}** 个提交。", ""]
    if not commits:
        # 区间为空 ≠ 上游没改：回钉、旁支、pin 记的 sha 被上游 force-push 掉都会走到这里。
        # 如实说「算不出」，绝不让读者把空清单读成「本次没有变化」。
        lines += ["> **区间为空**：目标 ref 不在当前 pin 之后（回钉 / 旁支 / 起点 sha 已失效）。",
                  "> 变更清单**算不出来**，这不等于「上游没有变化」——"
                  "改按文件级变更账与上游 release 页人工核对。", ""]
    lines.append("| 类别 | 条数 |")
    lines.append("|------|------|")
    for key, label in BUCKETS:
        if counts[key]:
            lines.append(f"| {label}（{key}） | {counts[key]} |")
    lines.append("")

    for key, label in BUCKETS:
        if key not in ("feat", "fix", "perf", "revert") or not counts[key]:
            continue
        lines.append(f"### {label}（{key}，{counts[key]} 条）")
        lines.append("")
        for c in commits:
            if c["kind"] == key:
                scope = f"**{c['scope']}** " if c["scope"] else ""
                lines.append(f"- {scope}{c['subject']}  `{c['sha']}`")
        lines.append("")

    surfaces = patch_target_files()
    feature = {n: f for n, f in surfaces.items() if n not in GENERATED_PATCHES}
    brand = set().union(*(f for n, f in surfaces.items() if n in GENERATED_PATCHES)) if surfaces else set()

    lines.append("### 撞特性补丁面（手维护补丁，逐条核对）")
    lines.append("")
    hit_any = False
    for name, files in sorted(feature.items()):
        hits = [(c, sorted(set(c["files"]) & files)) for c in commits if set(c["files"]) & files]
        lines.append(f"**`{name}`**（补丁面 {len(files)} 文件）：{len(hits)} 个提交撞面")
        lines.append("")
        if not hits:
            lines.append("- 无。上游本区间没动这张补丁要打的任何文件——大概率干净落位。")
        else:
            hit_any = True
            for c, fs in hits:
                lines.append(f"- {c['subject']}  `{c['sha']}`")
                lines.append(f"  - 撞：{'、'.join(f'`{f}`' for f in fs[:6])}"
                             + ("…" if len(fs) > 6 else ""))
        lines.append("")
    if not hit_any and feature:
        lines.append("> 判定依据是**文件交集**而非关键词：上游没动补丁要打的文件，"
                     "补丁就打得上。`git apply --check` 的结论以引擎实跑为准。")
        lines.append("")

    brand_hits = [c for c in commits if set(c["files"]) & brand]
    counter: dict[str, int] = {}
    for c in brand_hits:
        for f in set(c["files"]) & brand:
            counter[f] = counter.get(f, 0) + 1
    lines.append(f"### 撞品牌换装覆盖面（{len(brand_hits)} 个提交 / 覆盖面 {len(brand)} 文件）")
    lines.append("")
    lines.append("品牌补丁由 `build/rebrand.py` 规则引擎整张重出，撞面**不需要人工重放**——"
                 "这里列出只为一件事：上游若改了规则锚点的上下文，替换会无声 no-op，"
                 "由 `test_hermes_charter.py` 的哨兵负责报红。改动最密的文件：")
    lines.append("")
    for f, n in sorted(counter.items(), key=lambda kv: -kv[1])[:10]:
        lines.append(f"- `{f}` —— {n} 次改动")
    if not counter:
        lines.append("- 无。上游本区间没碰换装覆盖面。")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- 换快照


def snapshot(tag: str, work: Path) -> dict:
    """全量替换 upstream/ 快照（`UPSTREAM.md` 例程步 1–2）。

    用 `git archive` 取 tracked 全集而非 `cp -r`：绕开双方 .gitignore 差异，
    与手办例程逐字同源。入库前必清生成物——树内跑过测试留下的 .pyc 会被
    `git add -f` 一并强推，2026-08-02 实测撞 GitHub 推送保护（脱敏测试样本里的假 token）。
    """
    clone = work / "hermes-snap"
    if clone.exists():
        shutil.rmtree(clone)
    run(["git", "clone", "--depth", "1", "--branch", tag, UPSTREAM_URL, str(clone)])
    sha = run(["git", "rev-parse", "HEAD"], cwd=clone).stdout.strip()
    tag_date = run(["git", "log", "-1", "--format=%cs"], cwd=clone).stdout.strip()

    if UPSTREAM.exists():
        shutil.rmtree(UPSTREAM)
    UPSTREAM.mkdir(parents=True)
    archive = subprocess.Popen(["git", "-C", str(clone), "archive", "HEAD"],
                               stdout=subprocess.PIPE)
    tar = subprocess.Popen(["tar", "-x", "-C", str(UPSTREAM)], stdin=archive.stdout)
    archive.stdout.close()
    tar.communicate()
    if tar.returncode != 0 or archive.wait() != 0:
        raise SyncError("git archive | tar 解包失败")

    for d in list(UPSTREAM.rglob("__pycache__")):
        shutil.rmtree(d, ignore_errors=True)
    for f in list(UPSTREAM.rglob("*.pyc")):
        f.unlink(missing_ok=True)

    files = sum(1 for p in UPSTREAM.rglob("*") if p.is_file())
    # du 报 "151M"，台账历来写 "156MB"——单位补齐，免得历次移 pin 的规模行看着像两套口径
    size = run(["du", "-sh", str(UPSTREAM)]).stdout.split()[0]
    if size and size[-1] in "KMGT":
        size += "B"

    init = UPSTREAM / "hermes_cli" / "__init__.py"
    m = re.search(r'^__version__ = "([^"]+)"', init.read_text(encoding="utf-8"), re.M)
    if not m:
        raise SyncError("新快照里读不出引擎版本（hermes_cli/__init__.py 的 __version__）")

    return {"sha": sha, "tag_date": tag_date, "engine": m.group(1),
            "files": files, "size": size}


def check_feature_patches() -> list[dict]:
    """特性补丁逐张核对新基底（例程步 3 的后半句）。

    只 `--check` 不实打：本脚本绝不替人工做重放判断。冲突即如实上报，
    由例程会话按 `WEEKLY-UPDATE.md` 接手。
    """
    out = []
    for p in sorted((SUB / "patches").glob("*.patch")):
        if p.name in GENERATED_PATCHES:
            continue
        r = run(["git", "apply", "--check",
                 f"--directory={UPSTREAM.relative_to(REPO)}", str(p)],
                cwd=REPO, check=False)
        out.append({"patch": p.name, "clean": r.returncode == 0,
                    "detail": (r.stderr or r.stdout).strip()[:800]})
    return out


def stage_and_stat() -> dict:
    """暂存快照并算文件级变更账。

    文件级差异**不走网络**：新快照已在工作树、旧快照在 git 索引里，
    `git diff --cached` 就是地面真相。
    """
    rel = str(UPSTREAM.relative_to(REPO))
    run(["git", "add", "-f", "-A", rel], cwd=REPO)
    short = run(["git", "diff", "--cached", "--shortstat", "--", rel], cwd=REPO).stdout.strip()
    names = run(["git", "diff", "--cached", "--name-status", "--", rel], cwd=REPO).stdout
    added = modified = deleted = 0
    for line in names.splitlines():
        st = line[:1]
        added += st == "A"
        modified += st == "M"
        deleted += st == "D"
    return {"shortstat": short, "added": added, "modified": modified, "deleted": deleted}


# ---------------------------------------------------------------- 编排


def do_sync(tag: str | None, work: Path, report_path: Path | None) -> tuple[int, dict]:
    pin = read_pin()
    target = tag or latest_tag()
    if target == pin["tag"]:
        rep = {"action": "noop", "reason": "已是最新 pin", **probe()}
        if report_path:
            report_path.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0, rep

    snap = snapshot(target, work)
    touched = sync_version_constants(snap["engine"])
    run(["python3", str(REBRAND)], cwd=SUB)            # 重生成两张品牌补丁
    patches = check_feature_patches()
    stat = stage_and_stat()
    commits = commit_log(pin["sha"], target, work)

    conflicts = [p["patch"] for p in patches if not p["clean"]]
    write_pin(tag=target, sha=snap["sha"], tag_date=snap["tag_date"],
              engine=snap["engine"], files=snap["files"], size=snap["size"],
              note=("周更例程自动移 pin" if not conflicts
                    else f"周更例程移 pin；特性补丁需人工重放：{'、'.join(conflicts)}"))

    rep = {
        "action": "synced",
        "from_tag": pin["tag"], "from_sha": pin["sha"], "from_engine": pin["engine"],
        "to_tag": target, "to_sha": snap["sha"], "to_engine": snap["engine"],
        "tag_date": snap["tag_date"], "files": snap["files"], "size": snap["size"],
        "version_constants_touched": touched,
        "feature_patches": patches,
        "conflicts": conflicts,
        "file_stat": stat,
        "commit_count": len(commits),
        "commits": commits,
        "changelog_md": changelog_markdown(commits, from_tag=pin["tag"], to_tag=target),
        "synced_at": datetime.now(BEIJING).isoformat(timespec="seconds"),
    }
    if report_path:
        report_path.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    return (3 if conflicts else 0), rep


# ---------------------------------------------------------------- 公告落档

BUNDLE_URL = ("https://github.com/lightproud/biav-sc-code/releases/download/"
              "black-pool-bundle/black-pool-win64.zip")
BUNDLE_PAGE = "https://github.com/lightproud/biav-sc-code/releases/tag/black-pool-bundle"


def announce_markdown(rep: dict) -> str:
    """渲染「更新公告 + zip 链接 + BPA 更新指南」三合一档。

    机器只填**能算准的部分**（版本 / 区间 / 变更账 / 补丁状态 / 链接 / 操作步骤）；
    「本周值得说的变化」留标记由例程会话补人话——机器不假装自己读懂了 900 个提交。
    """
    d = rep
    conflicts = d.get("conflicts") or []
    # 冲突时**只陈述已发生的事**（同步期 --check 报红），不替例程会话宣布「已重放」——
    # 重放结果是第五节的人工填空，机器不得把未发生的事写成完成态（§4.2 R3）。
    patch_line = ("三张补丁全部干净落位（品牌两张规则引擎重出，特性补丁 `--check` 通过）"
                  if not conflicts else
                  f"**特性补丁 {'、'.join(conflicts)} 在新基底冲突 —— 重放结果见第五节**")
    stat = d.get("file_stat", {})

    return f"""# Black Pool 周更公告 · 上游 {d['to_tag']}（引擎 {d['to_engine']}）

> 银芯周更例程自动产出（每周一 00:00 北京时间 / 周日 16:00 UTC 起跑）。
> 本档三合一：**新内容公告** + **zip 下载链接** + **BPA 更新指南**。
> 上游 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)（MIT）——
> 黑池为其品牌换装 + 内网适配的二次开发衍生物，非纯自研。

## 一、本次更新是什么

| 项 | 值 |
|----|----|
| 上游 pin | `{d['from_tag']}` → **`{d['to_tag']}`**（commit `{d['to_sha'][:12]}`，{d['tag_date']}） |
| 引擎版本 | {d['from_engine']} → **{d['to_engine']}** |
| 黑池版本 | 0.1.0（品牌版本号不随上游走） |
| 上游提交 | {d['commit_count']} 个 |
| 快照变更 | {stat.get('added', 0)} 新增 / {stat.get('modified', 0)} 修改 / {stat.get('deleted', 0)} 删除文件 |
| 快照规模 | {d['files']:,} 文件 / {d['size']} |
| 补丁核对 | {patch_line} |

<!-- 例程会话在此补一段人话概述：本周对黑池用户**实际可感知**的变化是什么。
     机器不写这一段——它只数得清提交条数，数不清哪条对用户重要。 -->

## 二、变更清单

{d['changelog_md']}

## 三、下载

| 版别 | 资产 | 链接 |
|------|------|------|
| 私有版（内网日常用） | `black-pool-win64.zip` | [直接下载]({BUNDLE_URL}) |
| Release 页（含 SHA-256 digest） | — | [black-pool-bundle]({BUNDLE_PAGE}) |

> 链接**恒定**、内容滚动——每次周更由组装线覆盖同一资产名。要核对拿到的是不是这一版，
> 解压后看包内 `BUILD.md` 的「上游 pin」行是否为 `{d['to_tag']}`。
> 公版 `black-pool-public-win64.zip` 不随周更出包，按需手动触发 `assemble-black-pool-public.yml`。

## 四、BPA 更新指南（内网 bpa-dev 车间）

**推荐路径——双击一键更新**：车间根 `bpa-dev\\deploy\\update.cmd`。六步流水线自动跑完
① 银芯克隆 `git pull --ff-only` → ② 车间 `svn update` → ③ 下载最新整包进 `releases\\`
（SHA-256 比对 Release 官方 digest）→ ④ `assemble.cmd` 组装（按 `config\\assembly.txt`
拼内网补丁 / 插件 / 技能 / 配置）→ ⑤ `deploy.cmd` 部署（旧 `home\\` 用户数据增量并入，
旧版让位 `.old` 回滚位）→ ⑥ 拉起部署位。日志落 `车间根\\update.log`。

**手动路径**（下载失败或要挑版本时）：

1. 从上表下载 zip 进 `bpa-dev\\releases\\`，比对 Release 页 digest 后登记进 `CHECKSUMS.txt`
2. `assemble.cmd black-pool-win64.zip` —— 出 `staging\\BlackPool\\` + 装配清单 `ASSEMBLY.md`
3. `deploy.cmd` —— 成品上位，旧版进 `.old`
4. 双击部署位 `Black Pool.lnk` 或 `launcher.cmd` 验收

**验收三看**：包内 `BUILD.md` 上游 pin = `{d['to_tag']}` · 关于页出身行 = 「基于 Hermes Agent
{d['to_engine']} 定制」· 内网补丁在 `ASSEMBLY.md` 里逐张有名有增删行数。

**出事回滚**：`rollback.cmd <部署目录>` 一键回切 `.old`，问题版留 `.failed-*` 供取证。

**纪律提醒**：换包**必经组装**——直接解压 zip 进部署位会丢掉全部内网补丁与配置；
整包不载测试套件（出厂清场已裁），跑 `scripts\\run_tests.sh` 会明说原因并指路。
详见 `projects/black-pool-agent/deploy/RUNBOOK.md`。

## 五、需要守密人注意的

<!-- 例程会话按实际情况填：补丁重放了哪几处 / 高风险条目里哪条真撞了 /
     组装线是否绿 / 有没有该挂 gaps.md 的漏缝。没有就写「无」，不留空标记。 -->
"""


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sp = ap.add_subparsers(dest="cmd", required=True)

    p = sp.add_parser("probe", help="探上游最新 tag 并与台账比对")
    p.add_argument("--json", action="store_true")

    p = sp.add_parser("sync", help="换快照 + 同步常量 + 重生成补丁 + 核对特性补丁 + 改台账")
    p.add_argument("--tag", help="指定目标 tag（缺省取上游最新）")
    p.add_argument("--work", help="临时克隆目录（缺省系统临时目录；务必在仓外）")
    p.add_argument("--report", help="同步报告 JSON 落点")

    p = sp.add_parser("changelog", help="取两 pin 之间的提交史并分类")
    p.add_argument("--from", dest="frm", required=True, help="起点 tag 或 commit")
    p.add_argument("--to", required=True, help="终点 tag 或 commit")
    p.add_argument("--work")
    p.add_argument("--out")

    p = sp.add_parser("announce", help="据同步报告渲染公告 + 更新指南")
    p.add_argument("--report", required=True, help="sync --report 产出的 JSON")
    p.add_argument("--out", help="落点（缺省经 deliverable_path 算 repo-engineering 路径）")

    args = ap.parse_args(argv)

    try:
        if args.cmd == "probe":
            rep = probe()
            if args.json:
                print(json.dumps(rep, ensure_ascii=False, indent=2))
            else:
                verdict = f"须移 pin → {rep['latest_tag']}" if rep["needs_update"] else "已是最新，无事可做"
                print(f"当前 pin: {rep['current_tag']}（引擎 {rep['current_engine']}）")
                print(f"上游最新: {rep['latest_tag']}")
                print(f"判定    : {verdict}")
            return 0

        work = Path(args.work) if getattr(args, "work", None) else Path(tempfile.mkdtemp(prefix="hermes-sync-"))
        work.mkdir(parents=True, exist_ok=True)
        if REPO in work.resolve().parents or work.resolve() == REPO:
            raise SyncError(f"工作目录必须在仓外（免得临时克隆被 git add 卷进快照）: {work}")

        if args.cmd == "sync":
            code, rep = do_sync(args.tag, work, Path(args.report) if args.report else None)
            if rep["action"] == "noop":
                print(f"无更新：上游最新仍是 {rep['latest_tag']}")
                return 0
            print(f"已换装快照 {rep['from_tag']} → {rep['to_tag']}"
                  f"（引擎 {rep['from_engine']} → {rep['to_engine']}，{rep['commit_count']} 提交）")
            print(f"文件账：{rep['file_stat'].get('shortstat') or '（无差异）'}")
            for p_ in rep["feature_patches"]:
                print(f"特性补丁 {p_['patch']}: {'干净' if p_['clean'] else '冲突 —— 需人工重放'}")
            if code == 3:
                print("\n退出码 3：特性补丁需人工重放，按 WEEKLY-UPDATE.md 第 3 步接手。", file=sys.stderr)
            return code

        if args.cmd == "changelog":
            commits = commit_log(args.frm, args.to, work)
            md = changelog_markdown(commits, from_tag=args.frm, to_tag=args.to)
            if args.out:
                Path(args.out).write_text(md, encoding="utf-8")
                print(f"已写入 {args.out}（{len(commits)} 提交）")
            else:
                print(md)
            return 0

        if args.cmd == "announce":
            rep = json.loads(Path(args.report).read_text(encoding="utf-8"))
            if rep.get("action") != "synced":
                raise SyncError("报告显示本次无更新，没有可发的公告")
            if args.out:
                out = Path(args.out)
            else:
                r = run(["python3", str(REPO / "scripts" / "deliverable_path.py"), "path",
                         "--type", "repo-engineering", "--topic", "hermes-weekly-update",
                         "--date", today().replace("-", "")], cwd=REPO)
                out = REPO / r.stdout.strip()
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(announce_markdown(rep), encoding="utf-8")
            print(out)
            return 0

    except SyncError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    sys.exit(main())

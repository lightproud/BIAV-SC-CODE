#!/usr/bin/env python3
"""死手开关 —— 只数空座位，不听课。

靶（设计档 `Public-Info-Pool/Resource/proposal/dead-man-switch-design-20260726.md`）：
**不是「机制报错时告诉我」（工作流失败会红，已有），而是「机制该出声却没出声时告诉我」**
（2026-07-26 前全仓为零）。两种沉默分开报，因为病因不同：

- `STALE` —— 曾经成功过，最近一次成功超出阈值（2026-07-26 的 store-patrol：连红 7 天）；
- `NEVER` —— 从来没成功过（同日的 community-platform-backup：建成次日即坏、从未触发，
  首个 cron 还在一周之后，「坏了」这个事件根本还没发生）。

三条设计取舍（守密人 2026-07-26 裁定「按建议推进」）：
1. **拉模式**：一个作业查 Actions API 覆盖全部定时工作流，不必改 N 个文件、不指望下一个
   作者记得加心跳——漏网面是推模式的死穴。
2. **阈值由 cron 自己推导**：期望间隔 = 该工作流全部 cron 的**最大相邻间隔**，阈值 =
   期望间隔 × `THRESHOLD_FACTOR` + `GRACE_HOURS`。清单只有一份，就是工作流文件本身。
3. **NEVER 宽限** = 工作流创建时刻 + 一个期望间隔（首个 cron 到期）+ 再一个间隔，
   新建工作流不会一落地就红。

克制（守卫的信誉是一次性的）：禁用的工作流跳过；无 cron 的（纯 workflow_dispatch）不纳入；
只报状态、不猜原因——它一分析就会变复杂，而元规则要求**守卫必须比它守的东西简单**。
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

REPO = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = REPO / ".github" / "workflows"
STATUS_PATH = REPO / "Public-Info-Pool" / "Record" / "heartbeat" / "status.json"

THRESHOLD_FACTOR = 2.0
GRACE_HOURS = 2.0

# 本工作流自身：判据必须换一维，否则警报会卡在常亮。
# 本作业的设计是「有发现就 exit 1 变红」（红=可见）。可它同时把自己也列入看守名单、
# 判据用「最近一次 workflow success」——于是：有发现 → 红 → 自己永无 success 记录 →
# 自己被判 never → findings 恒 ≥ 1 → 永远红。自 2026-07-26 建成起 27 次运行 27 次红，
# 从第一天就锁死；2026-08-18 采集全线停摆 70 小时时它确实抓到并写进了 status.json，
# 但那抹红与前 24 天的自噬性红色毫无分别，等于没有警报。
# 改判「上一轮有没有扫完」——status.json 的 generated_at 每轮无条件落盘（findings
# 与否都写），正是设计档里点名的那一维。循环就此断开：无真发现时可转绿，红重新有信息量。
SELF_WORKFLOW = "dead-man-switch.yml"
#  cron 采样窗口：要能覆盖到月度 cron 的两次触发（每月 3 日 → 需 > 31 天）
SAMPLE_DAYS = 400

CRON_BOUNDS = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]


def parse_field(spec: str, lo: int, hi: int) -> set[int]:
    """展开单个 cron 字段。支持 `*` / `a` / `a-b` / `a,b` / `*/n` / `a-b/n`。"""
    values: set[int] = set()
    for part in spec.split(","):
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = int(step_s)
            if step <= 0:
                raise ValueError(f"步长必须为正: {spec}")
        if part in ("*", "?"):
            start, end = lo, hi
        elif "-" in part.lstrip("-"):
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
        else:
            start = end = int(part)
        if start < lo or end > hi or start > end:
            raise ValueError(f"字段越界: {part} 不在 [{lo},{hi}]")
        values.update(range(start, end + 1, step))
    return values


def _matches_day(dom_spec: str, dow_spec: str, dom: set[int], dow: set[int], when: datetime) -> bool:
    """cron 的日/周语义：两者都被限定时取「或」，否则取「与」。"""
    # cron 的 dow：0/7 = 周日；Python weekday(): 周一=0
    cron_dow = (when.weekday() + 1) % 7
    dom_hit = when.day in dom
    dow_hit = cron_dow in dow or (7 in dow and cron_dow == 0)
    if dom_spec.strip() not in ("*", "?") and dow_spec.strip() not in ("*", "?"):
        return dom_hit or dow_hit
    return dom_hit and dow_hit


def fire_times(cron: str, start: datetime, days: int = SAMPLE_DAYS) -> list[datetime]:
    """窗口内的全部触发时刻。只遍历 minute/hour 集合，不逐分钟扫。"""
    fields = cron.split()
    if len(fields) != 5:
        raise ValueError(f"cron 须为 5 段: {cron!r}")
    minutes, hours, doms, months, dows = (
        # strict=True：fields 已校验为 5 段、CRON_BOUNDS 恒 5 项，此处钉死二者同长,
        # 将来任一侧改动而另一侧漏改时当场报错，而不是静默少解析一段 cron。
        parse_field(f, lo, hi) for f, (lo, hi) in zip(fields, CRON_BOUNDS, strict=True)
    )
    out: list[datetime] = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        if day.month not in months:
            continue
        if not _matches_day(fields[2], fields[4], doms, dows, day):
            continue
        for hour in sorted(hours):
            for minute in sorted(minutes):
                out.append(day.replace(hour=hour, minute=minute))
    return sorted(out)


def expected_interval_hours(crons: Iterable[str], reference: datetime) -> float:
    """期望间隔 = 全部 cron 触发时刻**并集**的最大相邻间隔。

    取最大而非平均：`discord-archive.yml` 同时有每日与每月两条 cron，按平均会得出一个
    没有任何一条 cron 真正满足的阈值。最大间隔才是「多久没动静算不对劲」的诚实answer。
    """
    stamps: list[datetime] = []
    for cron in crons:
        stamps.extend(fire_times(cron, reference))
    stamps = sorted(set(stamps))
    if len(stamps) < 2:
        raise ValueError("采样窗口内触发次数不足，无法推导间隔")
    gaps = [
        # strict=False 是刻意的：相邻配对天然差一项，截断即预期行为
        (b - a).total_seconds() / 3600.0 for a, b in itertools.pairwise(stamps)
    ]
    return max(gaps)


def scheduled_workflows(workflow_dir: Path = WORKFLOW_DIR) -> dict[str, list[str]]:
    """{工作流文件名: [cron...]}，只收带 schedule 的。纯 dispatch 的本就不该定期出声。"""
    import re

    # 三种写法都认：单引号 / 双引号 / 裸值（YAML 三者等价，作者随手换一种是完全合法的编辑）。
    # 旧式只认单引号——一个 `- cron: "0 7 * * *"` 就会让该工作流**整个从看守名单里蒸发**，
    # 而死手开关照旧报 watched=N-1、findings=0：守卫对一个已死的定时件保持全程沉默，
    # 正是本脚本存在要消灭的那种沉默。（`build_status_facts.py` 数「其中定时」用的是
    # `^\s*-\s*cron:`，不挑引号——两边判据分叉时，台账数字与看守数字会无声对不上。）
    line = re.compile(
        r"^[ \t]*-[ \t]*cron:[ \t]*(?:'([^']*)'|\"([^\"]*)\"|([^#\r\n]+?))[ \t]*(?:#.*)?$",
        re.MULTILINE,
    )
    found: dict[str, list[str]] = {}
    # `.yml` 与 `.yaml` **都要收**：GitHub 视二者等价，只认前者时，一个
    # `nightly.yaml` 里的定时件从看守名单里整件蒸发，而摘要行照报 watched=N
    # findings=0——与下面「引号写法」那条同一个病根（漏网面是拉模式的死穴）。
    for path in sorted([*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml")]):
        crons = [
            (single or double or bare).strip()
            for single, double, bare in line.findall(path.read_text(encoding="utf-8"))
        ]
        crons = [c for c in crons if c]
        if crons:
            found[path.name] = crons
    return found


def _api(url: str, token: str | None) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - 固定 api.github.com
        return json.loads(response.read().decode("utf-8"))


def github_fetcher(repo: str, token: str | None) -> Callable[[str], dict]:
    """返回 fetch(workflow_file) -> {created_at, state, last_success}；失败向上抛。"""

    def fetch(workflow_file: str) -> dict:
        base = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_file}"
        meta = _api(base, token)
        runs = _api(f"{base}/runs?status=success&per_page=1", token)
        items = runs.get("workflow_runs") or []
        return {
            "created_at": meta.get("created_at"),
            "state": meta.get("state", "active"),
            "last_success": items[0].get("updated_at") if items else None,
        }

    return fetch


def self_last_beat(status_path: Path = STATUS_PATH) -> str | None:
    """本工作流上一轮扫完的时间，取自它上一次写下的 status.json。

    读的是**上一轮**留下的文件（本轮的还没写），所以这就是「昨天有没有扫」的直接答案。
    读不到（首次运行 / 文件损坏）返回 None，交回 classify 的 created_at 宽限逻辑。
    """
    try:
        return json.loads(status_path.read_text(encoding="utf-8")).get("generated_at")
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        return None


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def classify(entry: dict, now: datetime) -> tuple[str, str]:
    """(state, note)。state ∈ ok / stale / never / skipped / unknown。"""
    if entry.get("state") not in (None, "active"):
        return "skipped", f"工作流非 active（{entry.get('state')}），不计沉默"
    interval = entry["expected_interval_h"]
    threshold = interval * THRESHOLD_FACTOR + GRACE_HOURS
    last = _parse_ts(entry.get("last_success"))
    if last is not None:
        age = (now - last).total_seconds() / 3600.0
        if age > threshold:
            return "stale", f"最近一次成功在 {age:.1f}h 前，超阈值 {threshold:.1f}h"
        return "ok", f"最近一次成功在 {age:.1f}h 前（阈值 {threshold:.1f}h）"
    created = _parse_ts(entry.get("created_at"))
    if created is None:
        return "unknown", "无成功记录且无创建时间，无法判定"
    # NEVER 宽限：首个 cron 到期（+1 间隔）再给一个间隔，新工作流不会一落地就红
    grace_deadline = created + timedelta(hours=interval * 2 + GRACE_HOURS)
    if now < grace_deadline:
        return "ok", f"新工作流，尚在首跑宽限内（至 {grace_deadline.isoformat()}）"
    return "never", f"创建于 {created.isoformat()}，至今从无一次成功"


def build_status(
    fetch: Callable[[str], dict],
    now: datetime,
    workflow_dir: Path = WORKFLOW_DIR,
    status_path: Path = STATUS_PATH,
) -> dict:
    entries = []
    for name, crons in scheduled_workflows(workflow_dir).items():
        record: dict = {"workflow": name, "cron": crons}
        try:
            record["expected_interval_h"] = round(expected_interval_hours(crons, now), 2)
        except ValueError as exc:
            record.update(state="unknown", note=f"cron 间隔无法推导: {exc}")
            entries.append(record)
            continue
        try:
            record.update(fetch(name))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            record.update(state="unknown", note=f"API 查询失败: {exc}")
            entries.append(record)
            continue
        if name == SELF_WORKFLOW:
            # 见 SELF_WORKFLOW 注释：自己的 workflow success 恒为空，改用心跳。
            record["last_success"] = self_last_beat(status_path) or record.get("last_success")
            record["self_judged_by"] = "status.json/generated_at"
        state, note = classify(record, now)
        record["state"] = state
        record["note"] = note
        entries.append(record)
    findings = [e for e in entries if e.get("state") in ("stale", "never")]
    # `watched` 数的是**座位**，不是**查成了的座位**：token 缺失 / 私仓 404 / 网络断时
    # 每条都降级 unknown，findings 仍是 0，于是状态档与摘要行一起呈现
    # 「watched=24 findings=0」——读起来是「盯了 24 个、全都健康」，实际是一个都没查到。
    # findings 的语义不动（unknown 不是断言「它死了」），但**判过几个**必须同时出现，
    # 否则这个守卫会以最像健康的方式失效——而守卫的信誉是一次性的。
    unknown = [e for e in entries if e.get("state") == "unknown"]
    judged = [e for e in entries if e.get("state") in ("ok", "stale", "never")]
    return {
        "generated_at": now.isoformat(),
        "threshold_factor": THRESHOLD_FACTOR,
        "grace_hours": GRACE_HOURS,
        "watched": len(entries),
        "judged": len(judged),
        "unknown": len(unknown),
        "findings": len(findings),
        "entries": entries,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="死手开关：报告该出声却没出声的定时工作流")
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "lightproud/BIAV-SC-CODE"))
    parser.add_argument("--out", type=Path, default=STATUS_PATH)
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    args = parser.parse_args(argv)

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    status = build_status(github_fetcher(args.repo, token), now)

    for entry in status["entries"]:
        if entry.get("state") in ("stale", "never", "unknown"):
            print(f"  [{entry['state'].upper():7}] {entry['workflow']}: {entry.get('note')}")
    print(f"死手开关：watched={status['watched']} judged={status['judged']} "
          f"unknown={status['unknown']} findings={status['findings']}")
    if status["watched"] and not status["judged"]:
        print("  ⚠ 一个工作流也没判成（全部 unknown）——findings=0 在此不代表健康，"
              "多半是 GH_TOKEN 缺失或 Actions API 不可达。")

    if not args.dry_run:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"状态已写入 {args.out}")
    if status["findings"]:
        return 1
    # 「一个都没判成」必须**也是红**，不能只打印一行警告就退 0。守卫退 0 的后果比
    # 别处严重：本工作流自己也在被看守名单里，而它的判据是「最近一次成功」——
    # 退 0 就是一次成功。于是 GH_TOKEN 失效 / Actions API 不通的日子里，死手开关
    # 天天绿灯、天天刷新 status.json 的 generated_at、天天把自己的「最近一次成功」
    # 顶到今天，**连它自己的失明都监控不到**（实测：token 无效时 watched=26
    # judged=0 unknown=26 findings=0，退出码 0）。watched=0（看守名单为空，如
    # .github/workflows 缺失或被稀疏检出裁掉）同理——那是在什么都没查的情况下报平安。
    if not status["judged"]:
        print("  ⚠ 判红：本轮 judged=0（看守名单为空或全部查询失败），"
              "findings=0 在此不是「全都健康」，而是「一个都没查到」。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

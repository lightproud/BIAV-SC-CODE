#!/usr/bin/env python3
"""Refresh the archived Claude Code system-prompts reference from upstream.

Pulls the latest snapshot of the public MIT-licensed repo
`Piebald-AI/claude-code-system-prompts` into
`Public-Info-Pool/Reference/Claude-Code-System-Prompts/`, deterministically:

  1. shallow-clone upstream to a temp dir,
  2. rsync its body into the archive (strip `.git`/`.gitignore`,
     protect our own `index.md` from `--delete`),
  3. rename upstream `CLAUDE.md` -> `UPSTREAM-CLAUDE.md`
     (avoid silver-core instruction-layer pollution),
  4. regenerate `index.md` provenance (version / commit / date / file count).

Public repo only — no Anthropic API, no secret, no cost. Silver-core mission #1
collection layer, one-way ingest (no black-pool touch, §1.1-HC clear).

Run: `python3 scripts/refresh_claude_code_prompts.py`
Exit 0 whether or not content changed; prints a one-line status.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

UPSTREAM = "https://github.com/Piebald-AI/claude-code-system-prompts.git"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEST = REPO_ROOT / "Public-Info-Pool" / "Reference" / "Claude-Code-System-Prompts"

# 银芯自持文件（非上游），镜像清理时须保护，勿被上游缺失而删除
SILVER_OWNED = {"index.md"}
# 上游本体中不搬进银芯的条目（顶层相对路径）
SKIP_TOP = {".git", ".gitignore"}


def run(cmd: list[str], cwd: Path | None = None) -> str:
    return subprocess.run(
        cmd, cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def mirror(src: Path, dst: Path) -> None:
    """Pure-Python rsync-like mirror: copy src->dst, delete dst extras.

    Protects SILVER_OWNED files in dst; skips SKIP_TOP entries from src.
    Dependency-free (no rsync), so it runs the same locally and in CI.
    """
    # 采集上游相对路径全集（跳过 SKIP_TOP 顶层条目）
    keep: set[str] = set()
    for root, dirs, files in os.walk(src):
        rel_root = Path(root).relative_to(src)
        top = rel_root.parts[0] if rel_root.parts else ""
        if top in SKIP_TOP:
            dirs[:] = []
            continue
        for name in files:
            # 根级文件（rel_root 无 parts）按自身文件名判 SKIP_TOP
            if not rel_root.parts and name in SKIP_TOP:
                continue
            rel = (rel_root / name).as_posix()
            keep.add(rel)
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(root) / name, target)

    # 清理 dst 中上游已不存在的文件（保护银芯自持文件）
    for root, _dirs, files in os.walk(dst):
        for name in files:
            rel = (Path(root).relative_to(dst) / name).as_posix()
            if rel in SILVER_OWNED or rel in keep:
                continue
            (Path(root) / name).unlink()
    # 清理空目录
    for root, dirs, files in os.walk(dst, topdown=False):
        p = Path(root)
        if p != dst and not any(p.iterdir()):
            p.rmdir()


def detect_version(clone: Path) -> str:
    """Best-effort upstream version, e.g. '2.1.201'. Falls back to 'unknown'."""
    readme = clone / "README.md"
    if readme.exists():
        m = re.search(r"Claude Code v(\d+\.\d+\.\d+)", readme.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    # fallback: any frontmatter `version:` in a system-prompt file
    sp = clone / "system-prompts"
    if sp.is_dir():
        for f in sorted(sp.glob("*.md")):
            m = re.search(r"^version:\s*v?(\d+\.\d+\.\d+)", f.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    return "unknown"


def render_index(version: str, commit: str, commit_date: str, prompt_count: int) -> str:
    # 刻意不放「本地刷新日期」：index.md 只随上游 version/commit/count 变，
    # 上游无更新的空跑周产生零 diff、不触发噪声提交。
    return f"""# Claude Code System Prompts — 外部参照归档

BPT 4R `Reference` 层子目录。**外部公开参照材料**（非银芯原创、非可执行源码），
供 AI 协作层（§1.4 记忆层 / 人格与编排）研习提示词工程之用。

> 本文件由 `scripts/refresh_claude_code_prompts.py` 自动生成 / 更新（勿手改版本表；
> 定时刷新见 `.github/workflows/refresh-claude-code-prompts.yml`）。

## 来源（provenance）

| 项 | 值 |
|----|----|
| 上游仓库 | [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) |
| 维护方 | Piebald AI（**非 Anthropic 官方**；由脚本从 `@anthropic-ai/claude-code` npm 编译产物提取） |
| 采集版本 | Claude Code v{version} |
| 上游 commit | `{commit}` |
| 上游 commit 日期 | {commit_date} |
| 许可证 | MIT（Copyright (c) 2025 Piebald LLC）——见同目录 `LICENSE`，再分发须随附 |

## 内容清单

- `system-prompts/`：**{prompt_count}** 份 markdown，每份含 YAML frontmatter（标注 Claude Code 版本 + 模板变量）。
  覆盖主循环系统提示、各子代理（explore / general-purpose / plan / code-review 多段 / security-review 等）、
  工具描述、会话摘要 / 标题生成 / 记忆挑选等编排环节的提示词。
- `README.md`：上游目录 + 逐提示词 token 计数总表。
- `CHANGELOG.md`：多版本（自 v2.0.14 起）的提示词变更史。
- `UPSTREAM-CLAUDE.md`：上游自带的 CLAUDE.md（**已改名**，原名 `CLAUDE.md`——为防被银芯指令层
  误当项目指令自动加载而重命名，内容未改，供审阅上游对本材料的定性说明）。
- `LICENSE`：MIT 全文。

## 为何归档进银芯

- **学习标的**：Claude Code 的提示词分层（主循环 / 子代理 / 工具描述 / 编排环节）是成熟的
  「神经符号白盒编排」样本，与银芯知识层北极星（`memory/knowledge-layer-design.md`）的
  提示词 / 人格 / 动态编排投资方向同域，可作对照参照。
- **公开信息**：整份材料来源为公开 GitHub 仓库 + MIT 许可，符合银芯公开信息层定位（§0）。

## 硬约束对齐

- **仅参照、不引为运行时约束**：本目录是「资料体」，银芯自身的运行时强约束仍以根 `CLAUDE.md`
  自动加载层 + 工具层为准（§5.3）。此处任何 markdown 都是弱约束参照，不改变艾瑞卡人格或银芯行为。
- **单向、无黑池**：本材料自公开渠道单向采入银芯（使命#1 采集层同向），与黑池防火墙（§1.1-HC）无涉，
  未触碰任何内部 / 黑池数据。

## 刷新方式（定期更新）

定时 CI（每周一次）自动执行 `scripts/refresh_claude_code_prompts.py`：浅克隆上游 →
同步进本目录（剥离 `.git`、保护本 `index.md`）→ 改名 `UPSTREAM-CLAUDE.md` →
重生成本 provenance 表 → 有变化才 `[skip ci]` 提交。手动刷新亦可直接跑该脚本。
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        clone = Path(tmp) / "ccsp"
        print(f"[refresh] cloning {UPSTREAM} ...", file=sys.stderr)
        run(["git", "clone", "--depth", "1", UPSTREAM, str(clone)])

        commit = run(["git", "rev-parse", "HEAD"], cwd=clone)
        commit_date = run(["git", "show", "-s", "--format=%cs", "HEAD"], cwd=clone)
        version = detect_version(clone)

        DEST.mkdir(parents=True, exist_ok=True)
        mirror(clone, DEST)

        # 上游 CLAUDE.md -> UPSTREAM-CLAUDE.md（防指令层污染）
        upstream_md = DEST / "CLAUDE.md"
        if upstream_md.exists():
            shutil.move(str(upstream_md), str(DEST / "UPSTREAM-CLAUDE.md"))

        prompt_count = len(list((DEST / "system-prompts").glob("*.md")))
        (DEST / "index.md").write_text(
            render_index(version, commit, commit_date, prompt_count), encoding="utf-8"
        )

    print(
        f"[refresh] synced v{version} commit {commit[:8]} "
        f"({commit_date}), {prompt_count} prompts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

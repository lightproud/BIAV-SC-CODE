#!/usr/bin/env python3
"""Silver Core 品牌换装补丁生成器（守密人 2026-08-02 需求 #1）。

定位：patches/ 里的品牌补丁**不手写**——本脚本持有替换规则与排除谓词，
对 upstream/ 快照的临时副本做确定性变换，产出可审计的统一 diff 落
`patches/silver-core-rebrand.patch`。移 pin 后重跑本脚本即重生成补丁，
不存在「手改补丁追上游」的维护深渊。

红线（与施工边界文书裁 10 / MIT 一致，机械守卫 tests/test_hermes_charter.py）：
- LICENSE / 版权行 / 上游 URL / HERMES_* 环境变量名 / X-Client-Name 遥测头
  / 配置键 / 路径（~/.hermes）一律不碰——只换「用户感知的显示名」，
  不抹来源事实。
- upstream/ 本体零修改：补丁只在部署组装期应用（见 deploy/README.md），
  vendor 快照与官方测试基线保持逐字节纯净。

用法：
  python3 deploy/rebrand.py            # 生成/刷新 patches/silver-core-rebrand.patch
  python3 deploy/rebrand.py --check    # 只校验现存补丁与规则输出一致（漂移守卫）
  python3 deploy/rebrand.py --apply DEST  # 对 DEST（upstream 的组装副本）就地应用变换
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB = HERE.parent
UPSTREAM = SUB / "upstream"
PATCH_PATH = SUB / "patches" / "silver-core-rebrand.patch"

# 扫描范围：用户可感知的 runtime 面（白名单目录）。
# apps/（desktop 为内部主要消费面，守密人 2026-08-02 补充情报）与 web/（desktop
# 所包 UI）在列；website/docs 等纯站点面不扫（残留清单见 BRANDING.md）。
RUNTIME_DIRS = ["agent", "hermes_cli", "gateway", "tools", "plugins",
                "ui-tui/src", "apps", "web"]

# 裸词换装目录：display 密集面（UI / i18n / 桌面壳）。裸词 "Hermes" 以词边界
# 正则替换——`updateHermes`（i18n 键）/ `HermesClient`（类名）等标识符因前后
# 紧邻字母数字下划线而免疫；小写 `hermes`（npm 包名 / 路径 / scheme）从不触碰。
# 连字符同列免疫边界（2026-08-02 生产事故订正）：`X-Hermes-Session-Token` 是
# HTTP 头名（功能标识符），被换成含空格的 "X-Silver Core-..." 即非法头名，
# desktop 全部设置页（Providers / Tools & Keys / Model）随之 ERR_INVALID_HTTP_TOKEN
# 崩加载。代价：德/荷式连字复合词（"Hermes-Plugins"）留在残留清单——保护优先于净度。
BARE_WORD_DIRS = ("apps", "web", "ui-tui/src")
BARE_WORD_RE = re.compile(r"(?<![A-Za-z0-9_-])Hermes(?![A-Za-z0-9_-])")
# .html 在列（2026-08-02 补漏）：desktop/web/bootstrap-installer 的 <title> 是
# 任务栏 / Alt-Tab 显示名的实际来源（Electron 加载页面后 document.title 覆盖窗口题）。
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".sh", ".yaml", ".yml", ".json",
                 ".html"}

# 特例规则（先于通用规则与跳线谓词，整句替换）：
# 兜底身份句——SOUL.md 缺席时的产品自述。品牌换 Silver Core；
# 「created by Nous Research」不保留在自述里（来源事实由 LICENSE 与
# 合规口径「基于 MIT 开源组件二次开发」承载，见文书裁 10）。
SPECIAL_RULES = [
    (
        "You are Hermes Agent, an intelligent AI assistant created by Nous Research. ",
        "You are Silver Core, an intelligent AI assistant. ",
    ),
]

# 跳线谓词：含以下片段的行不做任何替换（保 URL / 环境变量 / 遥测 / 版权）。
LINE_SKIP_MARKERS = [
    "http://", "https://", "HERMES_", "X-Client-Name",
    "Copyright", "copyright", "SPDX-License-Identifier",
]

# 通用规则（逐行、按序应用）。刻意不把裸词 "Hermes"/"hermes" 入规则——
# 那会波及模块名 / 路径 / 配置键（功能标识符），属 fork 级改动。
GENERIC_RULES = [
    ("Hermes Agent", "Silver Core"),
    ("Hermes profile", "Silver Core profile"),
    ("hermes-tui", "silver-core-tui"),
    # 全大写字标（2026-08-02 补漏）：desktop 对话空态 / bootstrap-installer 欢迎页
    # 的巨幅 wordmark 是 'HERMES AGENT'，大小写敏感的前三条全部漏网。
    ("HERMES AGENT", "SILVER CORE"),
]

# 后置全文规则（在逐行规则之后对全文应用）：插入体里允许保留 "Hermes" 字样
# （来源事实陈述），因为不会再被后续规则二次换装。
# About 页出身声明（守密人 2026-08-02 裁定「直接说明这是 B.I.A.V. Studio
# 基于 Hermes 0.19.1 的定制版本」）：锚定 about-settings.tsx 版本行 JSX，
# 版本号取运行时 appVersion 动态渲染，移 pin 后无需改词。
POST_RULES = [
    (
        "            {version?.appVersion ? a.version(version.appVersion)"
        " : a.versionUnavailable}\n          </p>\n",
        "            {version?.appVersion ? a.version(version.appVersion)"
        " : a.versionUnavailable}\n          </p>\n"
        "          <p className=\"mt-1 text-xs text-muted-foreground\">\n"
        "            {'B.I.A.V. Studio 基于 Hermes Agent'"
        " + (version?.appVersion ? ` ${version.appVersion}` : '')"
        " + ' 的定制版本'}\n"
        "          </p>\n",
    ),
    # About 自更新区整块隐藏（守密人 2026-08-02 裁定；与文书 §2.4「生产禁用
    # hermes update、更新只有换 tag 重测」同向——便携包里该区只会报 git checkout
    # 错误误导用户）。{false && (<>...</>)} 包裹而非删除：对上游 diff 最小、
    # 移 pin 冲突面最小。哨兵防静默复活见 tests/test_hermes_charter.py。
    (
        "      <div className=\"mx-auto mt-4 w-full max-w-2xl\">\n"
        "        <SectionHeading icon={RefreshCw} title={a.updates} />\n",
        "      <div className=\"mx-auto mt-4 w-full max-w-2xl\">\n"
        "        {/* 便携包生产禁用自更新（文书 §2.4）——About 隐藏该区（2026-08-02 裁定） */}\n"
        "        {false && (<>\n"
        "        <SectionHeading icon={RefreshCw} title={a.updates} />\n",
    ),
    (
        "          title={a.automaticUpdates}\n"
        "        />\n"
        "\n"
        "        <UninstallSection />\n",
        "          title={a.automaticUpdates}\n"
        "        />\n"
        "        </>)}\n"
        "\n"
        "        {/* 便携包无安装器——Danger zone 整区隐藏（守密人 2026-08-02 裁定） */}\n"
        "        {false && <UninstallSection />}\n",
    ),
    # ---- 2026-08-02 改名审计轮（守密人「继续检查改名 bug + 不再必要功能」派发） ----
    # (1) APP_NAME 兜底统一：该行含 HERMES_ 被跳线保留，兜底值 'Hermes' 与已换装的
    # productName（'Silver Core'）分裂——electron userData 路径在 app.setName 前后
    # 按不同名字解析，绕过 launcher 直启 exe 时配置会写进两个目录（脑裂）。
    # 环境变量名原样保留，只统一兜底字面量。
    (
        "const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME || 'Hermes'\n",
        "const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME || 'Silver Core'\n",
    ),
    # (2) 后台更新轮询整只 no-op：便携包更新通道 = 换 tag 重测（文书 §2.4），
    # 轮询（挂载 + 每 30 分钟 + 窗口聚焦）只会反复报「isn't a git checkout」。
    (
        "export function startUpdatePoller(): void {\n"
        "  if (pollerStarted || typeof window === 'undefined') {\n",
        "export function startUpdatePoller(): void {\n"
        "  // 便携包禁自更新（文书 §2.4）——后台轮询只产错误噪音，整只 no-op。\n"
        "  if (true as boolean) {\n"
        "    return\n"
        "  }\n"
        "\n"
        "  if (pollerStarted || typeof window === 'undefined') {\n",
    ),
    # (3) Billing 入口隐藏：Hermes Cloud 订阅/额度页，内网便携包用自有 Providers，
    # 该页无对象。spread-空数组帘子，保留代码结构。
    (
        "      {\n"
        "        active: activeView === 'billing',\n"
        "        icon: BarChart3,\n"
        "        id: 'billing',\n"
        "        label: t.settings.nav.billing,\n"
        "        onSelect: () => setActiveView('billing')\n"
        "      },\n",
        "      // 内网便携包无 Hermes Cloud 订阅——Billing 入口隐藏（2026-08-02 审计轮）\n"
        "      ...(false\n"
        "        ? [\n"
        "            {\n"
        "              active: activeView === 'billing',\n"
        "              icon: BarChart3,\n"
        "              id: 'billing',\n"
        "              label: t.settings.nav.billing,\n"
        "              onSelect: () => setActiveView('billing')\n"
        "            }\n"
        "          ]\n"
        "        : []),\n",
    ),
    # (4) 钉钉 relay 默认名抑制加固：旧持久化配置里存的可能仍是换装前的
    # "Hermes Agent"，只比对新名会漏抑制、回复前缀泄漏旧品牌名。两名并收。
    (
        '        if value == "Silver Core":\n'
        '            value = ""\n',
        '        if value in ("Silver Core", "Hermes Agent"):\n'
        '            value = ""\n',
    ),
]

# 二进制品牌资产覆盖（2026-08-02 补漏：图标是二进制，文本规则到不了）：
# 源在 deploy/brand-assets/（由 deploy/gen_brand_assets.py 从单一源图生成，
# 守密人换图 = 换源图重跑生成器再重生成补丁），覆盖进组装树的消费点。
# mac 的 assets/icon.icns 刻意不覆盖（便携包只出 win，残留清单见 BRANDING.md）。
ASSET_OVERLAYS = [
    ("icon.png", "apps/desktop/assets/icon.png"),          # electron-builder 图标基座
    ("icon.ico", "apps/desktop/assets/icon.ico"),          # win exe / 任务栏 / 托盘
    ("apple-touch-icon.png", "apps/desktop/public/apple-touch-icon.png"),  # 运行时窗口图标 + favicon
    ("brand-tile.jpg", "apps/desktop/public/nous-girl.jpg"),  # About 页 BrandMark 品牌位
]

# 文件级排除：测试 / LICENSE / 锁文件 / 文档。
def _skip_file(rel: Path) -> bool:
    s = rel.as_posix()
    name = rel.name
    if "LICENSE" in name or name.endswith((".md", ".lock", ".min.js")):
        return True
    if name in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"):
        return True
    if "/tests/" in f"/{s}" or name.startswith("test_") or name.endswith("_test.py"):
        return True
    return rel.suffix not in TEXT_SUFFIXES


def transform_text(text: str, bare_word: bool = False) -> str:
    for old, new in SPECIAL_RULES:
        text = text.replace(old, new)
    out_lines = []
    for line in text.splitlines(keepends=True):
        if any(m in line for m in LINE_SKIP_MARKERS):
            out_lines.append(line)
            continue
        for old, new in GENERIC_RULES:
            line = line.replace(old, new)
        if bare_word:
            line = BARE_WORD_RE.sub("Silver Core", line)
        out_lines.append(line)
    text = "".join(out_lines)
    for old, new in POST_RULES:
        text = text.replace(old, new)
    return text


def overlay_assets(root: Path) -> int:
    """把 deploy/brand-assets/ 的品牌二进制资产覆盖进组装树，返回覆盖文件数。"""
    src_dir = HERE / "brand-assets"
    replaced = 0
    for src_name, dest_rel in ASSET_OVERLAYS:
        src = src_dir / src_name
        dest = root / dest_rel
        if not src.is_file():
            print(f"[warn] brand asset missing, skip: {src}", file=sys.stderr)
            continue
        if not dest.parent.is_dir():
            continue
        shutil.copyfile(src, dest)
        replaced += 1
    return replaced


def apply_tree(root: Path) -> int:
    """对 root（upstream 布局的副本）就地应用变换，返回改动文件数。"""
    changed = 0
    for d in RUNTIME_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root)
            if _skip_file(rel):
                continue
            try:
                text = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            bare = rel.as_posix().startswith(BARE_WORD_DIRS)
            new = transform_text(text, bare_word=bare)
            if new != text:
                p.write_text(new, encoding="utf-8")
                changed += 1
    changed += overlay_assets(root)
    return changed


def generate_patch() -> str:
    """在临时 git 仓里做变换，产出相对 upstream 根的统一 diff。"""
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "w"
        shutil.copytree(UPSTREAM, work, symlinks=False,
                        ignore=shutil.ignore_patterns(".venv", "__pycache__"))
        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(["git", "-C", str(work), *args],
                                  capture_output=True, text=True, check=True)
        run("init", "-q")
        run("config", "user.email", "rebrand@silver-core.local")
        run("config", "user.name", "rebrand")
        run("add", "-A")
        run("commit", "-qm", "pristine")
        n = apply_tree(work)
        # --binary：图标类品牌资产覆盖以 GIT binary patch 形式入补丁，
        # git apply 路径与 --apply 路径保持效果等同（deploy/README.md 二选一承诺）。
        diff = run("diff", "--binary").stdout
        print(f"transformed files: {n}", file=sys.stderr)
        return diff


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", metavar="DEST")
    args = ap.parse_args()

    if args.apply:
        n = apply_tree(Path(args.apply).resolve())
        print(f"applied rebrand to {args.apply}: {n} files changed")
        return 0

    diff = generate_patch()
    if args.check:
        current = PATCH_PATH.read_text(encoding="utf-8") if PATCH_PATH.exists() else ""
        if current != diff:
            print("DRIFT: patches/silver-core-rebrand.patch 与规则输出不一致，"
                  "跑 python3 deploy/rebrand.py 重生成", file=sys.stderr)
            return 1
        print("patch is in sync with rules")
        return 0
    PATCH_PATH.write_text(diff, encoding="utf-8")
    print(f"wrote {PATCH_PATH} ({len(diff.splitlines())} diff lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

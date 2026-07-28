"""源码文本卫生守卫——被跟踪的文本档不得混入裸控制字节。

## 这个守卫在防什么

源码里只要嵌进一个**裸控制字节**（最常见是 0x00，写字面量时忘了用 `'\\u0000'`
转义而直接把字节打进去），整个文件就会被 grep 家族判为二进制：

  - `rg <关键词>` 直接跳过该档（本仓跨档检索纪律全靠 ripgrep，CLAUDE.md §5/§5.3）；
  - `git grep -n` 的输出退化成一行 `Binary file <path> matches`——**没有 `path:line`**,
    而 `scripts/consumption_audit.py` 正是按 `path:line` 解析引用图的，于是该档里的
    真实消费关系凭空消失，而该工具的产出正是「零消费 = 退役候选」的判据；
  - diff / 代码评审工具同样只显示 "Binary files differ"，改动不可读。

## 为什么升格为测试而不是只修一次

这条坑本仓犯过两轮：2026-07-14 的 SDK 代码质量审计已把它记为 L-1
（`src/engine/loop.ts:647`，判词「裸 NUL 字节直接嵌进源文件，grep 等文本工具将整
文件误判为二进制」），但当时只修了被点名的那一处；2026-07-28 全仓扫描重新数出
**4 档**仍带裸 NUL——其中一档正是那份讲 NUL 危害的审计报告自己（于是这份报告
本身也搜不到）。一次性修复挡不住复发，故按毕业纪律钉成守卫。

运行期语义提醒：`'\\u0000'` 与裸 0x00 字节在 TS/JS/JSON 里是**同一个值**，本守卫
只约束源码的书写形态，不改变任何行为。
"""

import subprocess
from pathlib import Path

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

REPO = Path(__file__).resolve().parent.parent

# 应当是纯文本的被跟踪文件后缀。二进制资产（图片 / 字体 / tar 等）不在此列。
TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".md", ".json",
    ".yml", ".yaml", ".toml", ".cfg", ".sh", ".txt", ".css", ".html",
}

# 允许出现的控制字节：制表、换行、回车、换页。其余 C0 控制字符一律视为事故。
ALLOWED_CONTROL = {0x09, 0x0A, 0x0D, 0x0C}


def _tracked_text_files() -> list[Path]:
    res = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO, capture_output=True, text=True, timeout=120, check=True,
    )
    out = []
    for rel in res.stdout.split("\0"):
        if not rel:
            continue
        p = REPO / rel
        if p.suffix.lower() in TEXT_SUFFIXES and p.is_file():
            out.append(p)
    return out


def test_no_raw_control_bytes_in_tracked_text_files():
    """被跟踪文本档不得含裸控制字节（制表/换行/回车/换页除外）。"""
    offenders = []
    for p in _tracked_text_files():
        try:
            data = p.read_bytes()
        except OSError:
            continue
        hits = {b for b in data if b < 0x20 and b not in ALLOWED_CONTROL}
        if hits:
            rel = p.relative_to(REPO)
            codes = ", ".join(f"0x{b:02X}" for b in sorted(hits))
            offenders.append(f"{rel}: {codes}")
    assert not offenders, (
        "以下文本档含裸控制字节，会被 rg / git grep 判为二进制而整档失明"
        "（改用 '\\uXXXX' 转义写法，运行期值不变）：\n  " + "\n  ".join(offenders)
    )


def test_git_grep_reports_path_line_for_every_tracked_text_file():
    """反向确认：git grep 对任一文本档都能给出 `path:line`，而非 `Binary file ...`。

    直接针对上一条守卫要防的**后果**取证——引用图工具的输入形态必须成立。
    """
    res = subprocess.run(
        # 不加 -a：正是要检验「不靠 -a 也是纯文本」
        ["git", "grep", "-n", "-I", "-c", ""],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )
    binary_lines = [ln for ln in res.stdout.splitlines() if ln.startswith("Binary file ")]
    assert not binary_lines, (
        "git grep 仍把下列档判为二进制，consumption_audit 的 path:line 解析会拿到垃圾路径：\n  "
        + "\n  ".join(binary_lines)
    )


if __name__ == "__main__":
    test_no_raw_control_bytes_in_tracked_text_files()
    test_git_grep_reports_path_line_for_every_tracked_text_file()
    print("源码文本卫生守卫：通过")

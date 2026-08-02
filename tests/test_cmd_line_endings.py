"""Windows 批处理行尾守卫:所有 .cmd/.bat 的 checkout 行尾必须是 CRLF。

这不是格式偏好,是正确性约束(2026-08-03 实证定案):cmd.exe 对 LF-only 批处理
会标签找不到 / 括号块中断,窗口在 pause 前就关闭——「双击没反应 / 一闪即没」整案
的根因就是 .gitattributes 全仓 `eol=lf` 默认扫到了 .cmd。此守卫锁住例外规则:
谁删掉 `*.cmd text eol=crlf`,这里立刻红。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True,
                          text=True, check=True).stdout


def test_all_batch_files_check_out_as_crlf():
    tracked = [line for line in _git("ls-files", "*.cmd", "*.bat").splitlines() if line]
    assert tracked, "仓里应至少有 sc-pull.cmd 等批处理档;ls-files 空说明本测试失配"
    out = _git("check-attr", "eol", "--", *tracked)
    bad = [line for line in out.splitlines() if not line.endswith(": eol: crlf")]
    assert not bad, (
        f"以下批处理档的 eol 属性不是 crlf(LF-only 批处理在 cmd.exe 下会静默中断,"
        f"双击一闪即没):{bad}。检查 .gitattributes 的 `*.cmd text eol=crlf` 规则是否被删改。"
    )


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))

"""文字注入外壳:把转录结果送进「你正在打字的地方」。

三档(本地才能跑,print 除外):
- print     直接打印(云端联调/调试用,唯一无本地依赖档);
- clipboard 复制到剪贴板,你自己 Ctrl+V(最稳、跨应用零权限,默认);
- type      模拟键盘逐字敲入当前焦点(需辅助功能/输入监控权限)。

依赖(pyperclip / pynput)惰性 import,缺失时给可读报错而非 import 期崩。
"""
from __future__ import annotations


def inject(text: str, mode: str = "clipboard") -> None:
    if not text:
        return
    if mode == "print":
        print(text)
        return
    if mode == "clipboard":
        try:
            import pyperclip
        except ImportError as e:  # pragma: no cover - 本地依赖
            raise RuntimeError("剪贴板注入需要 pyperclip:pip install pyperclip") from e
        pyperclip.copy(text)
        print(f"[已复制到剪贴板,Ctrl+V 粘贴] {text}")
        return
    if mode == "type":
        try:
            from pynput.keyboard import Controller
        except ImportError as e:  # pragma: no cover - 本地依赖
            raise RuntimeError("键盘注入需要 pynput:pip install pynput") from e
        Controller().type(text)
        return
    raise ValueError(f"未知注入模式: {mode!r}(可用: print, clipboard, type)")

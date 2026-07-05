"""转录后端注册表:换引擎 = 换一个类,粘合层不动。

内置:
- fake          确定性假后端(测试/联调,无 ML 无麦克风)
- faster-whisper 本地默认引擎(离线,initial_prompt 偏置)

日后可 register("funasr", FunASRTranscriber) 挂 FunASR(热词词表 + 流式 + 声纹)。
"""
from __future__ import annotations

from .base import Segment, Transcriber, Transcript
from .fake import FakeTranscriber

__all__ = ["Transcriber", "Transcript", "Segment", "get_backend", "available", "register"]

_REGISTRY: dict[str, type] = {"fake": FakeTranscriber}

_ALIASES = {
    "faster-whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
    "faster_whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
    "whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
}


def register(name: str, cls: type) -> None:
    _REGISTRY[name.lower()] = cls


def available() -> list[str]:
    return ["fake", "faster-whisper"]


def get_backend(name: str, **kw) -> Transcriber:
    key = (name or "").lower()
    if key in _ALIASES:
        module, cls_name = _ALIASES[key]
        mod = __import__(f"{__name__}.{module}", fromlist=[cls_name])
        return getattr(mod, cls_name)(**kw)
    if key in _REGISTRY:
        return _REGISTRY[key](**kw)
    raise ValueError(f"未知转录后端: {name!r}(可用: {', '.join(available())})")

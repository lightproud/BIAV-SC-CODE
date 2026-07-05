"""转录后端注册表:换引擎 = 换一个类,粘合层不动。

两族能力,分流解析:
- **批处理**(整段进出,base.Transcriber):`fake` / `faster-whisper`;`get_backend`。
- **流式**(边喂边出,streaming.StreamingTranscriber):`fake-streaming` / `sherpa-onnx`;
  `get_streaming_backend`。

日后可 register("funasr", ...) 挂 FunASR(热词词表 + 流式 + 声纹)。
"""
from __future__ import annotations

from .base import Segment, Transcriber, Transcript
from .fake import FakeTranscriber
from .streaming import (
    FakeStreamingTranscriber,
    StreamingSession,
    StreamingTranscriber,
    StreamResult,
)

__all__ = [
    "Transcriber", "Transcript", "Segment", "get_backend", "available", "register",
    "StreamingTranscriber", "StreamingSession", "StreamResult",
    "get_streaming_backend", "streaming_available",
]

# --- 批处理 ---
_REGISTRY: dict[str, type] = {"fake": FakeTranscriber}

_ALIASES = {
    "faster-whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
    "faster_whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
    "whisper": ("faster_whisper_backend", "FasterWhisperTranscriber"),
}

# --- 流式 ---
_STREAMING_REGISTRY: dict[str, type] = {"fake-streaming": FakeStreamingTranscriber}

_STREAMING_ALIASES = {
    "sherpa-onnx": ("sherpa_backend", "SherpaOnnxStreamingTranscriber"),
    "sherpa": ("sherpa_backend", "SherpaOnnxStreamingTranscriber"),
    "sherpa_onnx": ("sherpa_backend", "SherpaOnnxStreamingTranscriber"),
}


def register(name: str, cls: type) -> None:
    _REGISTRY[name.lower()] = cls


def register_streaming(name: str, cls: type) -> None:
    _STREAMING_REGISTRY[name.lower()] = cls


def available() -> list[str]:
    return ["fake", "faster-whisper"]


def streaming_available() -> list[str]:
    return ["fake-streaming", "sherpa-onnx"]


def _load(module: str, cls_name: str, **kw):
    mod = __import__(f"{__name__}.{module}", fromlist=[cls_name])
    return getattr(mod, cls_name)(**kw)


def get_backend(name: str, **kw) -> Transcriber:
    key = (name or "").lower()
    if key in _ALIASES:
        return _load(*_ALIASES[key], **kw)
    if key in _REGISTRY:
        return _REGISTRY[key](**kw)
    raise ValueError(f"未知转录后端: {name!r}(可用: {', '.join(available())})")


def get_streaming_backend(name: str, **kw) -> StreamingTranscriber:
    key = (name or "").lower()
    if key in _STREAMING_ALIASES:
        return _load(*_STREAMING_ALIASES[key], **kw)
    if key in _STREAMING_REGISTRY:
        return _STREAMING_REGISTRY[key](**kw)
    raise ValueError(f"未知流式后端: {name!r}(可用: {', '.join(streaming_available())})")

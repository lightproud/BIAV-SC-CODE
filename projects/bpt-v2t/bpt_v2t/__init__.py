"""BPT-V2T:银芯语音转文字(voice-as-input → 听记地基)。

路线(守密人 2026-07-05):真引擎落地(地基)= sherpa-onnx 本地流式,交付形态 = 本地 Web UI。
Phase A(已落盘)= sherpa-onnx 流式后端 + 专名热词桥 + 模型管理;Phase B Web UI;Phase C 声纹。

两族后端:
- 批处理(整段进出):fake / faster-whisper —— `backends.get_backend`;
- 流式(边喂边出):fake-streaming / sherpa-onnx —— `backends.get_streaming_backend`。

分层(云端可建可测 vs 本地才能跑):
- 内核(hotwords / backends / models):纯逻辑 + 惰性依赖,云端容器可构建可测;
- 外壳(recorder / injector):麦克风采集 + 输入注入,只能在守密人本机跑。
"""
from __future__ import annotations

from . import hotwords, models
from .config import Settings

__all__ = ["hotwords", "models", "Settings", "__version__"]
__version__ = "0.2.0"

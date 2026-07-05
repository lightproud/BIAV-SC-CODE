"""BPT-V2T:银芯语音代替输入(voice-as-input)首期内核。

范围(守密人 2026-07-05 降维裁定):
- 只做「语音代替键盘输入」——按热键说话 → 转文字 → 注入正在打字的地方;
- 暂不做声纹(录入/识别)、暂不做持续会议转录 / 钉钉听记完整体验;
- 转录引擎重决策暂缓,默认取最轻的本地后端 faster-whisper,并做成可插拔。

分层(云端可建可测 vs 本地才能跑):
- 内核(hotwords / backends):纯逻辑 + 惰性依赖,云端容器可构建可测;
- 外壳(recorder / injector):麦克风采集 + 输入注入,只能在守密人本机跑。
"""
from __future__ import annotations

from . import hotwords
from .config import Settings

__all__ = ["hotwords", "Settings", "__version__"]
__version__ = "0.1.0"

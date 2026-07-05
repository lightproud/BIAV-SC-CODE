"""BPT-V2T 运行配置。CLI/环境可覆盖;字段即语音输入小工具的全部旋钮。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Settings:
    # --- 转录内核(云端可测) ---
    backend: str = "faster-whisper"   # fake | faster-whisper(可插拔,见 backends/)
    model: str = "small"              # faster-whisper 模型档:tiny/base/small/medium/large-v3
    language: str = "zh"
    device: str = "auto"              # auto | cpu | cuda
    compute_type: str = "auto"        # auto | int8 | float16 ...
    bias_max_chars: int = 200         # 专名偏置串字符预算(whisper initial_prompt 上限约束)

    # --- 本地外壳(须本机跑) ---
    inject: str = "clipboard"         # clipboard | type | print
    record_seconds: float = 0.0       # >0 定长录音;0 = 按键推挽(push-to-talk)手动停
    sample_rate: int = 16000
    channels: int = 1

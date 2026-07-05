"""BPT-V2T 运行配置。CLI/环境可覆盖;字段即语音输入小工具的全部旋钮。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Settings:
    # --- 批处理引擎(faster-whisper 路线) ---
    backend: str = "faster-whisper"   # fake | faster-whisper(可插拔,见 backends/)
    model: str = "small"              # faster-whisper 模型档:tiny/base/small/medium/large-v3
    bias_max_chars: int = 200         # 专名偏置串字符预算(whisper initial_prompt 上限约束)

    # --- 流式引擎(sherpa-onnx 路线,听记地基) ---
    streaming: bool = False           # True = 走流式(--stream)
    streaming_backend: str = "sherpa-onnx"   # fake-streaming | sherpa-onnx
    model_id: str = "zh-streaming-zipformer-14m"   # sherpa 模型清单 id(见 models.py)
    decoding_method: str = "modified_beam_search"  # 热词必须(greedy 不支持)
    hotwords_score: float = 1.5
    num_threads: int = 2

    # --- 通用 ---
    language: str = "zh"
    device: str = "auto"              # auto | cpu | cuda(faster-whisper)
    compute_type: str = "auto"        # auto | int8 | float16 ...(faster-whisper)
    provider: str = "cpu"             # cpu | cuda(sherpa-onnx)

    # --- 本地外壳(须本机跑) ---
    inject: str = "clipboard"         # clipboard | type | print
    record_seconds: float = 0.0       # >0 定长录音;0 = 按键推挽(push-to-talk)手动停
    block_ms: int = 100               # 流式麦克风分块粒度(毫秒)
    sample_rate: int = 16000
    channels: int = 1

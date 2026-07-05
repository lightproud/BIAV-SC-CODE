"""转录后端统一契约:音频入 → 文字出。

实现纪律:
- 惰性加载重依赖(模型/GPU),import 本模块不得触发下载或占显存;
- 无输入不崩;
- bias_prompt / hotwords 二选一或都收,后端按自身能力择用(whisper 系用 prompt,
  FunASR 系用 hotwords 词表),不支持的参数静默忽略并在 docstring 注明。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Union

Audio = Union[str, Path, "object"]  # 文件路径 或 (np.ndarray, sample_rate)


@dataclass
class Segment:
    text: str
    start: float = 0.0
    end: float = 0.0


@dataclass
class Transcript:
    text: str
    segments: list[Segment] = field(default_factory=list)
    language: str = ""


class Transcriber(ABC):
    """转录后端基类。子类实现 transcribe()。"""

    name = "base"

    @abstractmethod
    def transcribe(
        self,
        audio: Audio,
        *,
        language: str = "zh",
        bias_prompt: Optional[str] = None,
        hotwords: Optional[list[str]] = None,
    ) -> Transcript:
        ...

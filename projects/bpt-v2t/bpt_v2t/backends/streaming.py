"""流式转录契约:边喂音频块、边取增量文字(区别于 base.py 的批处理整段进出)。

为什么另立一套:批处理 `Transcriber.transcribe(整段)->Transcript` 做不出「边说边出字」
的听记体验。流式把交互拆成「喂块 accept → 取增量 poll → 收尾 finish」,让持续麦克风
一边录一边吐 partial(假设文本,会被后续块修正)与 final(到 endpoint 定稿、换行)。

分层照旧:本模块含契约 + 确定性假实现(云端可测,无 ML 无麦克风);真 sherpa 引擎在
sherpa_backend.py(惰性加载、本地跑)。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class StreamResult:
    """一次 poll 吐出的增量。

    - text:  当前段的文字(未定稿时是会被修正的 partial)
    - is_final: 到 endpoint、本段定稿(下一段从空开始)
    - speaker:  说话人标签占位(Phase C 声纹填,现恒 None)
    """

    text: str
    is_final: bool = False
    speaker: Optional[str] = None


class StreamingSession(ABC):
    """一次流式会话(对应一路麦克风)。喂块 → 取增量 → 收尾。"""

    @abstractmethod
    def accept(self, samples, sample_rate: int) -> None:
        """喂入一块 float32 PCM 采样。"""

    @abstractmethod
    def poll(self) -> list[StreamResult]:
        """取自上次 poll 以来的增量结果(可能空、可能含 partial 与 final)。"""

    def finish(self) -> list[StreamResult]:
        """输入结束,冲刷尾段。默认无尾段。"""
        return []


class StreamingTranscriber(ABC):
    """流式后端:开一路会话。"""

    name = "base-streaming"

    @abstractmethod
    def stream(
        self, *, language: str = "zh", hotwords_file: Optional[str] = None
    ) -> StreamingSession:
        ...


# ---------------------------------------------------------------------------
# 确定性假实现(测试 / Web 协议联调):把预设脚本按 accept 次数吐 partial→final
# ---------------------------------------------------------------------------


class FakeStreamingSession(StreamingSession):
    """把一句话按「喂块次数」逐步吐出:前几块吐 partial 前缀,末块(finish)吐 final。

    规则(确定性、可断言):
    - 每 accept 一次,推进一个「词」(以空格切;无空格则整串一次到位),poll 回当前前缀 partial;
    - finish() 吐整句 final。
    """

    def __init__(self, script: str = "") -> None:
        self._words = script.split() if script else []
        self._i = 0
        self._script = script

    def accept(self, samples, sample_rate: int) -> None:  # noqa: ARG002
        if self._i < len(self._words):
            self._i += 1

    def poll(self) -> list[StreamResult]:
        if not self._words:
            return []
        text = " ".join(self._words[: self._i])
        if not text:
            return []
        return [StreamResult(text=text, is_final=False)]

    def finish(self) -> list[StreamResult]:
        if not self._script:
            return []
        return [StreamResult(text=self._script, is_final=True)]


class FakeStreamingTranscriber(StreamingTranscriber):
    name = "fake-streaming"

    def __init__(self, script: str = "你好 世界", **_ignored) -> None:
        self._script = script

    def stream(
        self, *, language: str = "zh", hotwords_file: Optional[str] = None
    ) -> FakeStreamingSession:  # noqa: ARG002
        return FakeStreamingSession(self._script)

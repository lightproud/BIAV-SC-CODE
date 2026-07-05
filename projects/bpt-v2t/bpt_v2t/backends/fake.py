"""确定性假后端:无 ML、无麦克风,供云端容器跑验证程序 + 联调外壳。

用途:测热词桥 / CLI 粘合 / 注入路径,不牵动真模型下载或活体录音。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from .base import Audio, Segment, Transcriber, Transcript


class FakeTranscriber(Transcriber):
    name = "fake"

    def __init__(self, script=None, **_ignored) -> None:
        # script 可为固定字符串,或 callable(audio, bias_prompt, hotwords) -> str
        self._script = script

    def transcribe(
        self,
        audio: Audio,
        *,
        language: str = "zh",
        bias_prompt: Optional[str] = None,
        hotwords: Optional[list[str]] = None,
    ) -> Transcript:
        if callable(self._script):
            text = self._script(audio, bias_prompt, hotwords)
        elif isinstance(self._script, str):
            text = self._script
        elif isinstance(audio, (str, Path)):
            text = f"[fake:{Path(audio).name}]"
        else:
            text = "[fake]"
        return Transcript(text=text, segments=[Segment(text=text)], language=language)

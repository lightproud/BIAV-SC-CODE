"""faster-whisper 本地后端(首期默认引擎)。

- 全离线:音频不出机;
- 中文质量好、pip 一行装(CTranslate2 加速的 whisper);
- 专名偏置走 initial_prompt(=bias_prompt);whisper 无「硬热词词表」机制,故
  hotwords 参数在本后端被忽略(仅 prompt 生效)——日后换 FunASR 后端可吃 hotwords。

惰性加载:构造不下模型,首次 transcribe() 才实例化 WhisperModel。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from .base import Audio, Segment, Transcriber, Transcript


class FasterWhisperTranscriber(Transcriber):
    name = "faster-whisper"

    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        compute_type: str = "auto",
        **_ignored,
    ) -> None:
        self._model_name = model
        self._device = device
        self._compute_type = compute_type
        self._model = None

    def _ensure(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # 惰性:避免 import 期触发依赖

            self._model = WhisperModel(
                self._model_name, device=self._device, compute_type=self._compute_type
            )
        return self._model

    def transcribe(
        self,
        audio: Audio,
        *,
        language: str = "zh",
        bias_prompt: Optional[str] = None,
        hotwords: Optional[list[str]] = None,
    ) -> Transcript:
        model = self._ensure()
        audio_arg = str(audio) if isinstance(audio, (str, Path)) else audio
        segments, info = model.transcribe(
            audio_arg, language=language, initial_prompt=bias_prompt or None
        )
        segs = [
            Segment(text=s.text.strip(), start=float(s.start), end=float(s.end))
            for s in segments
        ]
        text = "".join(s.text for s in segs).strip()
        lang = getattr(info, "language", None) or language
        return Transcript(text=text, segments=segs, language=lang)

"""sherpa-onnx 流式后端(真引擎,本地跑)。

一栈吃下:流式 zipformer transducer 转录 + 上下文热词(专名增益)+ endpoint 断句。
说话人 embedding(声纹)留 Phase C(sherpa 同栈的 SpeakerEmbeddingExtractor)。

关键点(据 k2-fsa 官方 python-api-examples 核实):
- 热词须 `decoding_method="modified_beam_search"`(greedy 不支持热词)+ `hotwords_file` +
  `hotwords_score`;中文按 `modeling_unit="cjkchar"`,热词文件每词空格分字(见 hotwords.py);
- 流式:`create_stream` → `accept_waveform(sr, samples)` → `while is_ready(s): decode_stream(s)`
  → `get_result(s)`;`is_endpoint(s)` 为真则本段定稿并 `reset(s)`。

惰性加载:构造不建引擎、不下模型,首次 stream() 才实例化 OnlineRecognizer。
"""
from __future__ import annotations

from typing import Optional

from .streaming import StreamingSession, StreamingTranscriber, StreamResult


class _SherpaStreamingSession(StreamingSession):
    def __init__(self, recognizer, stream) -> None:
        self._rec = recognizer
        self._s = stream
        self._last = ""

    def accept(self, samples, sample_rate: int) -> None:
        self._s.accept_waveform(sample_rate, samples)
        while self._rec.is_ready(self._s):
            self._rec.decode_stream(self._s)

    def poll(self) -> list[StreamResult]:
        text = self._rec.get_result(self._s)
        out: list[StreamResult] = []
        is_endpoint = self._rec.is_endpoint(self._s)
        if text and text != self._last:
            out.append(StreamResult(text=text, is_final=False))
            self._last = text
        if is_endpoint:
            if text:
                out.append(StreamResult(text=text, is_final=True))
            self._rec.reset(self._s)
            self._last = ""
        return out

    def finish(self) -> list[StreamResult]:
        # 冲刷:标记输入结束,把剩余 ready 解完,吐最后一段 final
        self._s.input_finished()
        while self._rec.is_ready(self._s):
            self._rec.decode_stream(self._s)
        text = self._rec.get_result(self._s)
        return [StreamResult(text=text, is_final=True)] if text else []


class SherpaOnnxStreamingTranscriber(StreamingTranscriber):
    name = "sherpa-onnx"

    def __init__(
        self,
        *,
        model_id: str = "",
        tokens: str = "",
        encoder: str = "",
        decoder: str = "",
        joiner: str = "",
        num_threads: int = 2,
        provider: str = "cpu",
        decoding_method: str = "modified_beam_search",
        hotwords_score: float = 1.5,
        modeling_unit: str = "cjkchar",
        **_ignored,
    ) -> None:
        self._model_id = model_id
        self._paths = {
            "tokens": tokens,
            "encoder": encoder,
            "decoder": decoder,
            "joiner": joiner,
        }
        self._num_threads = num_threads
        self._provider = provider
        self._decoding_method = decoding_method
        self._hotwords_score = hotwords_score
        self._modeling_unit = modeling_unit
        self._recognizer = None

    def _resolve_paths(self) -> dict:
        # 直接给全路径优先;否则按 model_id 从 models.py 解析
        if all(self._paths.values()):
            return dict(self._paths)
        if not self._model_id:
            raise ValueError("sherpa-onnx 后端需 model_id 或四件模型全路径(tokens/encoder/decoder/joiner)")
        from .. import models  # 惰性,避免测试 import 期拉网络

        return models.resolve(self._model_id)

    def _ensure(self, hotwords_file: Optional[str]):
        if self._recognizer is None:
            import sherpa_onnx  # 惰性:import 期不触发

            p = self._resolve_paths()
            self._recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                tokens=p["tokens"],
                encoder=p["encoder"],
                decoder=p["decoder"],
                joiner=p["joiner"],
                num_threads=self._num_threads,
                provider=self._provider,
                sample_rate=16000,
                feature_dim=80,
                decoding_method=self._decoding_method,
                hotwords_file=hotwords_file or "",
                hotwords_score=self._hotwords_score,
                modeling_unit=self._modeling_unit,
                enable_endpoint_detection=True,
            )
        return self._recognizer

    def stream(
        self, *, language: str = "zh", hotwords_file: Optional[str] = None
    ) -> _SherpaStreamingSession:  # noqa: ARG002
        rec = self._ensure(hotwords_file)
        return _SherpaStreamingSession(rec, rec.create_stream())

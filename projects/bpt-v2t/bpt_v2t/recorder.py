"""麦克风采集外壳(本地才能跑:云端容器无麦克风)。

依赖 sounddevice + numpy,惰性 import——import 本模块不需要声卡,只有真录音时才要。
两种取音:定长录音 record_seconds();按键推挽 record_push_to_talk()(回车停)。
输出统一为 (float32 单声道 ndarray, sample_rate),直接喂后端 transcribe()。
"""
from __future__ import annotations


class MicRecorder:
    def __init__(self, sample_rate: int = 16000, channels: int = 1) -> None:
        self.sample_rate = sample_rate
        self.channels = channels

    def _sd(self):
        import sounddevice as sd  # 惰性:无声卡环境不因 import 崩

        return sd

    def record_seconds(self, seconds: float):
        """录固定时长(秒),阻塞到录完。返回 (ndarray[float32], sample_rate)。"""
        import numpy as np

        sd = self._sd()
        frames = int(seconds * self.sample_rate)
        buf = sd.rec(frames, samplerate=self.sample_rate, channels=self.channels, dtype="float32")
        sd.wait()
        return np.squeeze(buf), self.sample_rate

    def record_push_to_talk(self):
        """开录 → 回车停(push-to-talk)。返回 (ndarray[float32], sample_rate)。"""
        import numpy as np

        sd = self._sd()
        chunks: list = []

        def _cb(indata, frames, time_info, status):  # noqa: ARG001
            chunks.append(indata.copy())

        with sd.InputStream(
            samplerate=self.sample_rate, channels=self.channels, dtype="float32", callback=_cb
        ):
            try:
                input("[录音中] 回车停止...")
            except (EOFError, KeyboardInterrupt):
                pass
        if not chunks:
            return np.zeros(0, dtype="float32"), self.sample_rate
        return np.squeeze(np.concatenate(chunks, axis=0)), self.sample_rate

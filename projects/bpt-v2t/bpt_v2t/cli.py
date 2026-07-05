"""BPT-V2T 语音输入 CLI:热键说话 → 转文字 → 注入 / 流式滚动字幕。

云端可跑的子集(不碰麦克风/模型):
- `--transcribe <音频文件>`     批处理转录一个音频文件,打印结果;
- `--show-hotwords`             打印热词偏置串与词表规模(验证专名桥);
- `--print-hotwords-file`       打印 sherpa-onnx 热词文件内容(验证流式专名桥)。
本机才能跑的子集(需麦克风):
- 默认推挽循环(批处理);`--inject clipboard|type|print` 选注入方式;
- `--stream`                    流式:持续麦克风 → sherpa-onnx → 终端滚动字幕(听记地基)。
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from . import hotwords
from .backends import get_backend, get_streaming_backend
from .config import Settings


def _build_settings(a: argparse.Namespace) -> Settings:
    s = Settings()
    if a.backend:
        s.backend = a.backend
    if a.model:
        s.model = a.model
    if a.language:
        s.language = a.language
    if a.inject:
        s.inject = a.inject
    if a.record_seconds is not None:
        s.record_seconds = a.record_seconds
    if a.streaming_backend:
        s.streaming_backend = a.streaming_backend
    if a.model_id:
        s.model_id = a.model_id
    s.streaming = bool(a.stream)
    return s


def _run_stream(s: Settings) -> int:
    """流式:持续麦克风 → 流式后端 → 终端滚动字幕。需麦克风(本机)。"""
    from .recorder import MicRecorder

    hw_path = hotwords.write_hotwords_file(
        Path(tempfile.gettempdir()) / "bpt_v2t.hotwords.txt"
    )
    backend = get_streaming_backend(
        s.streaming_backend,
        model_id=s.model_id,
        num_threads=s.num_threads,
        provider=s.provider,
        decoding_method=s.decoding_method,
        hotwords_score=s.hotwords_score,
    )
    session = backend.stream(language=s.language, hotwords_file=str(hw_path))
    rec = MicRecorder(sample_rate=s.sample_rate, channels=s.channels)
    print(f"[BPT-V2T] 流式就绪(引擎 {s.streaming_backend},热词 {hw_path})。Ctrl+C 退出。")
    try:
        for samples, sr in rec.stream_chunks(block_ms=s.block_ms):
            session.accept(samples, sr)
            for r in session.poll():
                if r.is_final:
                    sys.stdout.write("\r" + r.text + "\n")
                else:
                    sys.stdout.write("\r" + r.text)
                sys.stdout.flush()
    except (KeyboardInterrupt, EOFError):
        for r in session.finish():
            if r.text:
                sys.stdout.write("\r" + r.text + "\n")
        print("[退出]")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bpt-v2t", description="银芯语音代替输入")
    p.add_argument("--backend", help="批处理后端: fake | faster-whisper")
    p.add_argument("--model", help="faster-whisper 模型档(tiny/base/small/medium/large-v3)")
    p.add_argument("--stream", action="store_true", help="流式模式(持续麦克风滚动字幕)")
    p.add_argument("--streaming-backend", dest="streaming_backend",
                   help="流式后端: fake-streaming | sherpa-onnx")
    p.add_argument("--model-id", dest="model_id", help="sherpa 模型清单 id(见 models.py)")
    p.add_argument("--language", default="zh")
    p.add_argument("--inject", choices=["print", "clipboard", "type"], help="注入方式")
    p.add_argument("--record-seconds", type=float, dest="record_seconds",
                   help="定长录音秒数;不给则回车停(push-to-talk)")
    p.add_argument("--transcribe", metavar="AUDIO", help="批处理转录一个音频文件后退出(不用麦克风)")
    p.add_argument("--show-hotwords", action="store_true", help="打印热词偏置串与词表规模后退出")
    p.add_argument("--print-hotwords-file", action="store_true",
                   help="打印 sherpa-onnx 热词文件内容后退出(不用麦克风)")
    a = p.parse_args(argv)

    s = _build_settings(a)

    if a.show_hotwords:
        bias = hotwords.bias_prompt(s.bias_max_chars)
        words = hotwords.hotword_list()
        print(f"热词表规模: {len(words)} 词")
        print(f"偏置串({len(bias)} 字): {bias}")
        return 0

    if a.print_hotwords_file:
        lines = hotwords.sherpa_hotwords_lines()
        print(f"# sherpa-onnx 热词文件({len(lines)} 词,cjkchar 分字)")
        print("\n".join(lines))
        return 0

    if s.streaming:
        return _run_stream(s)

    bias = hotwords.bias_prompt(s.bias_max_chars)
    backend = get_backend(s.backend, model=s.model, device=s.device, compute_type=s.compute_type)

    if a.transcribe:
        t = backend.transcribe(a.transcribe, language=s.language, bias_prompt=bias)
        print(t.text)
        return 0

    # --- 本地推挽循环(批处理,需麦克风) ---
    from .injector import inject
    from .recorder import MicRecorder

    rec = MicRecorder(sample_rate=s.sample_rate, channels=s.channels)
    print("[BPT-V2T] 语音输入就绪。Ctrl+C 退出。")
    try:
        while True:
            if s.record_seconds and s.record_seconds > 0:
                input(f"回车开始录音 {s.record_seconds}s ...")
                audio = rec.record_seconds(s.record_seconds)
            else:
                input("回车开始录音(下一回车停)...")
                audio = rec.record_push_to_talk()
            t = backend.transcribe(audio, language=s.language, bias_prompt=bias)
            if t.text:
                inject(t.text, mode=s.inject)
            else:
                print("[空转录,跳过]")
    except (KeyboardInterrupt, EOFError):
        print("\n[退出]")
        return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

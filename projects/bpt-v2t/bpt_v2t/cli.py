"""BPT-V2T 语音输入 CLI:热键说话 → 转文字 → 注入。

云端可跑的子集:
- `--transcribe <音频文件>`  转录一个音频文件(内核路径,不碰麦克风),打印结果;
- `--show-hotwords`          打印热词偏置串与词表规模(验证专名桥)。
本机才能跑的子集:
- 默认推挽循环(录音需麦克风);`--inject clipboard|type|print` 选注入方式。
"""
from __future__ import annotations

import argparse

from . import hotwords
from .backends import get_backend
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
    return s


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bpt-v2t", description="银芯语音代替输入")
    p.add_argument("--backend", help="转录后端: fake | faster-whisper")
    p.add_argument("--model", help="faster-whisper 模型档(tiny/base/small/medium/large-v3)")
    p.add_argument("--language", default="zh")
    p.add_argument("--inject", choices=["print", "clipboard", "type"], help="注入方式")
    p.add_argument("--record-seconds", type=float, dest="record_seconds",
                   help="定长录音秒数;不给则回车停(push-to-talk)")
    p.add_argument("--transcribe", metavar="AUDIO", help="转录一个音频文件后退出(不用麦克风)")
    p.add_argument("--show-hotwords", action="store_true", help="打印热词偏置串与词表规模后退出")
    a = p.parse_args(argv)

    s = _build_settings(a)
    bias = hotwords.bias_prompt(s.bias_max_chars)

    if a.show_hotwords:
        words = hotwords.hotword_list()
        print(f"热词表规模: {len(words)} 词")
        print(f"偏置串({len(bias)} 字): {bias}")
        return 0

    backend = get_backend(s.backend, model=s.model, device=s.device, compute_type=s.compute_type)

    if a.transcribe:
        t = backend.transcribe(a.transcribe, language=s.language, bias_prompt=bias)
        print(t.text)
        return 0

    # --- 本地推挽循环(需麦克风) ---
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

# BPT-V2T · 银芯语音代替输入

按热键说话,转成文字,喂进你正在打字的地方——等价一个系统级「语音输入法」,
并用《忘却前夜》专有名词词典提高识别率。

> 路线(守密人 2026-07-05):优先级 = 真引擎落地(地基),引擎 = **sherpa-onnx**,交付形态 =
> **本地 Web UI**。分三期:**Phase A** sherpa-onnx 流式后端地基(**已落盘**)→ Phase B 本地 Web UI
> → Phase C 声纹。详见 [`CONTEXT.md`](./CONTEXT.md)。

## 快速开始

```bash
pip install -r requirements.txt          # 引擎 + 本地外壳依赖
cd projects/bpt-v2t

# 不碰麦克风/模型(云端也能跑)
python -m bpt_v2t.cli --show-hotwords         # whisper 偏置串
python -m bpt_v2t.cli --print-hotwords-file   # sherpa 热词文件
python scripts/fetch_model.py --list          # 模型清单

# 流式语音转文字(需麦克风):持续录音 → 终端滚动字幕(听记地基)
python scripts/fetch_model.py                 # 首次:拉默认 sherpa 模型(联网)
python -m bpt_v2t.cli --stream

# 批处理语音输入(需麦克风):回车录、回车停、复制到剪贴板
python -m bpt_v2t.cli --inject clipboard
```

sherpa-onnx 全程离线,音频不出机;模型按 `models.py` 清单下载到 `~/.cache/bpt-v2t`。

## 设计要点

- **内核 / 外壳两分**:转录逻辑云端可测,麦克风与注入只在本机跑(云端无麦克风)。
- **两族后端**:批处理 `fake`/`faster-whisper`(`get_backend`)+ 流式 `fake-streaming`/`sherpa-onnx`(`get_streaming_backend`);换引擎换一个类。
- **专名增益**:热词表复用银芯领域词典(`scripts/silver_tokenizer.py`),仓库知识长它就长;whisper 走 `initial_prompt`、sherpa 走 `hotwords_file`。

## 测试

```bash
pytest projects/bpt-v2t/tests -v   # 31 项,仅依赖内核 + 假后端,无需麦克风/真模型
```

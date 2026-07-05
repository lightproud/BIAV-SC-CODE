# BPT-V2T · 银芯语音代替输入

按热键说话,转成文字,喂进你正在打字的地方——等价一个系统级「语音输入法」,
并用《忘却前夜》专有名词词典提高识别率。

> 首期范围(守密人 2026-07-05 降维):**只做语音代替输入**。持续会议转录、声纹
> 录入/识别、钉钉听记完整体验均留作后续轮次。详见 [`CONTEXT.md`](./CONTEXT.md)。

## 快速开始

```bash
pip install -r requirements.txt          # 内核 + 本地外壳依赖
cd projects/bpt-v2t

# 看专名热词偏置(不碰麦克风)
python -m bpt_v2t.cli --show-hotwords

# 语音输入(需麦克风):回车开录、回车停、结果复制到剪贴板
python -m bpt_v2t.cli --inject clipboard
```

首次使用 `faster-whisper` 会自动下载模型(`--model tiny/base/small/medium/large-v3`
选大小,越大越准越慢)。全程离线,音频不出机。

## 设计要点

- **内核 / 外壳两分**:转录逻辑云端可测,麦克风与注入只在本机跑(云端无麦克风)。
- **可插拔后端**:`fake`(测试)+ `faster-whisper`(默认);换引擎换一个类。
- **专名增益**:热词表复用银芯领域词典(`scripts/silver_tokenizer.py`),仓库知识长它就长。

## 测试

```bash
pytest projects/bpt-v2t/tests -v   # 仅依赖内核 + 假后端,无需麦克风/真模型
```

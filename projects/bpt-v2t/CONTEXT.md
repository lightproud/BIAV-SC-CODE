# bpt-v2t — 子项目会话上下文

## 定位

BPT-V2T:银芯**语音代替输入**(voice-as-input)工具。按热键说话 → 转成文字 →
注入你正在打字的地方(等价系统级「语音输入法」),并朝钉钉听记式「边说边出字」演进。
**非使命线**工程子项目。

- 派发来源:守密人 2026-07-05 会话。原始诉求为「持续麦克风录音 + 声纹录入识别 +
  专名增益、对标钉钉听记」,首期守密人**三连降维**(引擎暂缓 / 仅语音代替输入 / 声纹暂不做),
  已交骨架(PR #443 已并 main)。
- **后续三决策(守密人 2026-07-05 同会话第二轮)**:优先级 = **真引擎落地(地基)**;
  引擎 = **sherpa-onnx**(本地流式,一栈吃下流式+声纹+热词);交付形态 = **本地 Web UI**。
  分三期:**Phase A** sherpa-onnx 流式后端地基(**已落盘**)→ Phase B 本地 Web UI → Phase C 声纹。

## 硬事实:云端无麦克风,分层是刚需

本仓库会话跑在云端容器,**没有麦克风**。故代码刻意两分:

| 层 | 文件 | 云端容器 |
|----|------|----------|
| **内核**(纯逻辑 + 惰性依赖) | `hotwords.py` / `backends/` / `models.py` | ✅ 可构建、可测 |
| **外壳**(麦克风 + 注入) | `recorder.py` / `injector.py` / `cli.py` 推挽 & 流式循环 | ❌ 须守密人本机跑 |

小学生比喻:想让机器人替你打字,得先教会它「听懂话」(内核,云端能教)再给它装
「耳朵和手」(外壳,只能在你桌上装)。

## 结构

```
projects/bpt-v2t/
├── CONTEXT.md
├── README.md
├── requirements.txt          # 内核 vs 本地外壳依赖分层标注
├── bpt_v2t/
│   ├── hotwords.py           # 专名热词桥:复用 silver_tokenizer.domain_dict();whisper 偏置串 + sherpa 热词文件
│   ├── config.py             # Settings 旋钮(批处理 + 流式两族)
│   ├── models.py             # sherpa 模型清单 + resolve/ensure(清单进 git,权重不进)
│   ├── backends/
│   │   ├── base.py           # 批处理契约 Transcriber + Transcript/Segment
│   │   ├── streaming.py      # 流式契约 StreamingTranscriber/Session/StreamResult + Fake 实现
│   │   ├── fake.py           # 批处理假后端(测试/联调)
│   │   ├── faster_whisper_backend.py  # 批处理引擎(本地离线,惰性)
│   │   ├── sherpa_backend.py # 流式引擎 sherpa-onnx(本地,惰性;听记地基)
│   │   └── __init__.py       # 双注册表 get_backend / get_streaming_backend
│   ├── recorder.py           # 麦克风:record_seconds/push_to_talk + stream_chunks(流式)
│   ├── injector.py           # 注入:print/clipboard/type(本地,惰性依赖)
│   └── cli.py                # 粘合:推挽循环(批)+ --stream(流式滚动字幕)
├── scripts/fetch_model.py    # 本地拉 sherpa 模型(需联网)
└── tests/                    # 仅依赖内核 + 假后端,云端可全绿(31 项)
```

## 专名增益(与仓库知识对齐)

`hotwords.py` **不自造词表**——复用 `scripts/silver_tokenizer.domain_dict()`
(72 唤醒体名/称号 + 卡牌术语 + 剧情单元 + 世界观固定词),故仓库知识长、热词表跟着长。
两口消费:`hotword_list()`(全量,供词表型后端如 FunASR)、`bias_prompt(max_chars)`
(预算截断串,供 whisper 系 `initial_prompt`,优先塞世界观词 + 角色名)。

## 可插拔后端(两族:批处理 vs 流式)

换引擎 = 换一个类,粘合层不动。**批处理**(整段进出)`fake` / `faster-whisper`,走
`get_backend`;**流式**(边喂边出)`fake-streaming` / `sherpa-onnx`,走 `get_streaming_backend`。
日后 `register_streaming("funasr", ...)` 可再挂 FunASR。

## 专名增益三口(按后端能力)

`hotwords.py` 复用 `silver_tokenizer.domain_dict()`(125 词),三种消费口:
`hotword_list()`(全量词表)/ `bias_prompt()`(whisper `initial_prompt` 偏置串)/
`write_hotwords_file()`(sherpa `hotwords_file`,cjkchar 每词空格分字)。

## 怎么跑

```bash
# 云端可跑(不碰麦克风/模型)
pytest projects/bpt-v2t/tests -v                 # 31 项全绿
python -m bpt_v2t.cli --show-hotwords            # whisper 偏置串
python -m bpt_v2t.cli --print-hotwords-file      # sherpa 热词文件
python scripts/fetch_model.py --list             # 模型清单

# 本机才能跑(需 pip install -r requirements.txt + 麦克风)
python scripts/fetch_model.py                    # 拉默认 sherpa 模型(联网)
python -m bpt_v2t.cli --stream                   # 流式:持续麦克风 → 终端滚动字幕(听记地基)
python -m bpt_v2t.cli --inject clipboard         # 批处理推挽:回车录、回车停、复制到剪贴板
```
(注:`python -m bpt_v2t.cli` 需在 `projects/bpt-v2t/` 目录下,或把该目录加入 PYTHONPATH。)

## 后续轮次(路线,守密人已定序)

- **Phase A 已落盘**:sherpa-onnx 流式后端地基 + 热词桥升级 + 模型管理;
- **Phase B(下一轮)**:本地 Web UI(FastAPI + WebSocket,服务端采麦、浏览器 live 字幕 + 归档);
- **Phase C(再下一轮)**:声纹(sherpa `SpeakerEmbeddingExtractor`+`Manager` 同栈,填 `StreamResult.speaker`);
- 更远:VAD 断句调优、桌面托盘壳、全局快捷键。

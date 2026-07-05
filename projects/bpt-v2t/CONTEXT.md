# bpt-v2t — 子项目会话上下文

## 定位

BPT-V2T:银芯**语音代替输入**(voice-as-input)工具。按热键说话 → 转成文字 →
注入你正在打字的地方(等价系统级「语音输入法」)。**非使命线**工程子项目。

- 派发来源:守密人 2026-07-05 会话。原始诉求为「持续麦克风录音 + 声纹录入识别 +
  专名增益、对标钉钉听记」,同会话守密人**三连降维**:
  - 转录引擎重决策(FunASR / 云 API / sherpa)→ **暂缓**;
  - 交付层 → **仅「语音代替输入」**(不做持续会议转录 / 钉钉听记完整体验);
  - 声纹(录入 + 识别)→ **暂不做**。
- 首期只交内核 + 可插拔后端 + 本地薄壳,把重引擎/声纹/连续转录留作后续轮次。

## 硬事实:云端无麦克风,分层是刚需

本仓库会话跑在云端容器,**没有麦克风**。故代码刻意两分:

| 层 | 文件 | 云端容器 |
|----|------|----------|
| **内核**(纯逻辑 + 惰性依赖) | `hotwords.py` / `backends/` | ✅ 可构建、可测 |
| **外壳**(麦克风 + 注入) | `recorder.py` / `injector.py` / `cli.py` 推挽循环 | ❌ 须守密人本机跑 |

小学生比喻:想让机器人替你打字,得先教会它「听懂话」(内核,云端能教)再给它装
「耳朵和手」(外壳,只能在你桌上装)。

## 结构

```
projects/bpt-v2t/
├── CONTEXT.md
├── README.md
├── requirements.txt          # 内核 vs 本地外壳依赖分层标注
├── bpt_v2t/
│   ├── hotwords.py           # 专名热词桥:复用 scripts/silver_tokenizer.domain_dict()
│   ├── config.py             # Settings 旋钮
│   ├── backends/
│   │   ├── base.py           # Transcriber 契约 + Transcript/Segment
│   │   ├── fake.py           # 确定性假后端(测试/联调,无 ML 无麦克风)
│   │   ├── faster_whisper_backend.py  # 默认引擎(本地离线,惰性加载)
│   │   └── __init__.py       # 注册表 get_backend/available/register
│   ├── recorder.py           # 麦克风采集(本地,惰性 sounddevice)
│   ├── injector.py           # 注入:print/clipboard/type(本地,惰性依赖)
│   └── cli.py                # 粘合:热键→录音→转录→注入
└── tests/                    # 仅依赖内核 + 假后端,云端可全绿
```

## 专名增益(与仓库知识对齐)

`hotwords.py` **不自造词表**——复用 `scripts/silver_tokenizer.domain_dict()`
(72 唤醒体名/称号 + 卡牌术语 + 剧情单元 + 世界观固定词),故仓库知识长、热词表跟着长。
两口消费:`hotword_list()`(全量,供词表型后端如 FunASR)、`bias_prompt(max_chars)`
(预算截断串,供 whisper 系 `initial_prompt`,优先塞世界观词 + 角色名)。

## 可插拔后端

换引擎 = 换一个类,粘合层不动。当前 `fake` + `faster-whisper`;日后
`register("funasr", ...)` 即可挂 FunASR(热词词表 + 流式 + 声纹),兑现被暂缓的重栈。

## 怎么跑

```bash
# 云端可跑(不碰麦克风/模型)
pytest projects/bpt-v2t/tests -v
python -m bpt_v2t.cli --show-hotwords            # 看专名偏置串
python -m bpt_v2t.cli --backend fake --transcribe any.wav

# 本机才能跑(需 pip install -r requirements.txt + 麦克风)
python -m bpt_v2t.cli --inject clipboard         # 推挽:回车录、回车停、复制到剪贴板
python -m bpt_v2t.cli --model medium --inject type
```
(注:`python -m bpt_v2t.cli` 需在 `projects/bpt-v2t/` 目录下,或把该目录加入 PYTHONPATH。)

## 后续轮次候选(守密人裁定后再动)

- 换/加真引擎(FunASR 热词 + 流式 / 云 API);
- 声纹录入 + 识别(说话人区分 or 身份鉴权);
- 持续录音 + 实时字幕 + 说话人分离(钉钉听记级);
- VAD 自动断句、桌面托盘壳、全局快捷键。

# 音频资产索引

> 数据来源：Wwise 音频银行解包 + 格式转换 | 共 2,325 条 OGG 音轨

## 提取流程

游戏音频以 Wwise 格式存储（`.bnk` 音频银行 + `.wem` 编码音频）。
提取与转换管线如下：

1. 从客户端 `StreamingAssets` 目录提取原始 Wwise 文件（156 个 `.bnk` + 3,302 个 `.wem`）
2. 使用 `vgmstream-cli` 将 `.wem` / `.bnk` 内嵌音频解码为 WAV
3. 使用 `ffmpeg`（libvorbis q6）将 WAV 编码为 OGG Vorbis
4. 最终产出 2,325 条 OGG 音轨（含 61 条从 `.bnk` 派生的音频）

## 统计

| 项目 | 数量 |
|------|------|
| OGG 音轨总数 | 2,325 |
| 其中 .bnk 派生 | 61 |
| 原始 .wem 文件 | 3,302 |
| 原始 .bnk 文件 | 156 |

## 下载

### OGG 转换版（推荐）

发布于 [GitHub Releases `audio-assets-v1`](https://github.com/lightproud/brain-in-a-vat/releases/tag/audio-assets-v1)，分为两个压缩包：

| 文件 | 内容 |
|------|------|
| `morimens-audio-ogg-part1.tar.gz` | 1,132 条音轨 + 61 条 bnk 派生音频 |
| `morimens-audio-ogg-part2.tar.gz` | 1,132 条音轨 |

### 原始 Wwise 文件

如需原始未转换的 Wwise 文件（156 个 `.bnk` + 3,302 个 `.wem`，共 3,462 个文件），
请前往 [GitHub Releases `audio-raw-v1`](https://github.com/lightproud/brain-in-a-vat/releases/tag/audio-raw-v1)。

## 技术说明

- 转换工具链：`vgmstream-cli` (decode) -> `ffmpeg` (encode)
- 输出格式：OGG Vorbis，libvorbis quality 6（约 192 kbps VBR）
- `.bnk` 文件为 Wwise SoundBank 容器，内含多段嵌入音频，已拆分为独立 OGG 文件
- 文件名保留原始 Wwise ID 以便与游戏数据关联

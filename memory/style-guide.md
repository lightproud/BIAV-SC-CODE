# 交付物视觉规范 / Deliverable Style Guide

> 本文件是所有交付物（PDF、HTML、PPT）的视觉规范基线。
> 所有 claude.ai 和 Code 会话生成文档时，请先阅读本文件。
> v2.0 — 2026.03.29 基于 Steam 评论分析报告实战迭代

-----

## 核心美学关键词

**苹果官网布局**：大量留白、大标题居中、一屏一主题、呼吸感强、排版驱动。
**手机阅读优先**：正文 ≥ 15pt，辅助文字 ≥ 11pt，表格 ≥ 13pt。

-----

## 调色板

### 基础色

| 用途 | 色值 | 说明 |
|------|------|------|
| 背景 | `#0a0b10` | 深黑底，所有交付物统一 |
| 主金 | `#c5a356` | 标题装饰线、按钮、强调边框 |
| 亮金 | `#e2c97e` | 章节标题、高亮文字、关键词 |
| 暗金 | `#8a7a48` | 辅助标注、列表符号、表格注释 |
| 正文 | `#d4c9a8` | 正文文字 |
| 辅助文字 | `#6b6040` | 页码、注释、签名、英文副标题 |
| 暗辅助 | `#5a5540` | 更低层级的辅助信息 |
| 卡片/表头底 | `#1e1a10` | 暖棕黑，表头背景、卡片底色 |
| 边框 | `#2a2515` | 表格边框、分隔线 |
| 装饰线 | `#3a3520` | 低对比度装饰线、引用框边 |
| 高亮框底 | `rgba(197,163,86,0.06)` | highlight-box 背景 |
| 偶数行底 | `rgba(197,163,86,0.04)` | 表格斑马纹 |

### 功能色（v2.0 新增）

| 用途 | 色值 | 说明 |
|------|------|------|
| 正面/安全 | `#7aad5a` | 好评率高、安全信号、正面指标 |
| 负面/风险 | `#c25a4a` | 差评、风险预警、负面指标 |
| 洞察/分析 | `#5a8aad` | 分析结论、中性洞察、数据解读 |
| 负面框底 | `rgba(194,90,74,0.06)` | risk-box 背景 |
| 正面框底 | `rgba(74,122,58,0.06)` | safe-box 背景 |
| 洞察框底 | `rgba(90,138,173,0.08)` | insight-box 背景 |

**绝对禁止**：冷蓝黑（如 `#12131c`）、纯白、纯灰、任何非暖色调的中性色。所有灰色必须偏暖偏棕。

-----

## 字体

| 用途 | 字体 | 字重 | 最小字号 |
|------|------|------|------|
| 章节标题 | Noto Serif CJK SC / Noto Serif SC | SemiBold (600) 或 Bold (700) | 22pt |
| h3 小标题 | Noto Sans CJK SC | Bold (700) | 16pt |
| 正文 | Noto Sans CJK SC | Medium (500) | 15pt |
| 表格内容 | Noto Sans CJK SC | Medium (500) | 13pt |
| 表头 | Noto Sans CJK SC | Bold (700) | 13pt |
| 页码/注释 | Noto Sans CJK SC | Regular (400) | 10pt |
| 封面主标题 | Noto Serif CJK SC | Bold (700) | 32pt |
| 封面英文副标题 | Noto Sans CJK SC | Light (300) | 11pt |
| 数值指标（卡片） | Noto Serif CJK SC | Bold (700) | 20pt |

**关键原则**：
- 必须用粗字重。Regular 仅用于页码和注释，标题和强调处永远用 SemiBold 或 Bold。
- 正文用 Medium (500) 而非 Regular (400)，在深色背景上可读性显著更好。
- 表格正文也用 Medium (500)，不再用 Regular。

-----

## 布局原则

- **一屏一主题**：每个章节 page-break-before: always
- **行高 2.0**：正文 line-height: 2，表格 line-height: 1.7
- **页边距**：A4 页面 18mm 上左右，16mm 下
- **段落间距**：4mm margin-bottom
- **列表缩进**：6mm padding-left，列表项前用 ◆（`#c5a356`，7pt）
- **章节标题与正文间距**：标题 margin-bottom 2mm + section-rule（40px × 2px，`#c5a356`）margin-bottom 5mm
- **避免孤页**：orphans: 3, widows: 3，关键区块 page-break-inside: avoid
- **对齐**：正文 text-align: justify，标题和引用 text-align: center

-----

## 表格规范

```css
table { width: 100%; border-collapse: collapse; font-size: 13pt; }
th { background: #1e1a10; color: #e2c97e; font-weight: 700; padding: 3mm 3mm; border: 0.5px solid #3a3520; }
td { padding: 2.5mm 3mm; border: 0.5px solid #2a2515; color: #c0b490; vertical-align: top; line-height: 1.7; font-weight: 500; }
tr:nth-child(even) td { background: rgba(197,163,86,0.04); }
tr:nth-child(odd) td { background: rgba(10,11,16,0.5); }
td b { color: #e2c97e; }
```

- 表格内长文本**必须用 Paragraph 对象**（reportlab）或正常 `<td>` 文本流（HTML），确保自动换行
- 允许表格跨页，不强制 page-break-inside: avoid
- 表格注释用 11pt，`#6b6040`，居中，letter-spacing 1pt

-----

## 特殊组件

### 高亮框 (highlight-box)
```css
border-left: 4px solid #c5a356;
padding: 5mm 6mm;
background: rgba(197,163,86,0.06);
color: #e2c97e;
font-weight: 500;
font-size: 15pt;
line-height: 1.9;
```

### 风险框 (risk-box)（v2.0 新增）
```css
border-left: 4px solid #c25a4a;
padding: 5mm 6mm;
background: rgba(194,90,74,0.06);
color: #d4a090;
font-size: 15pt;
line-height: 1.9;
/* strong 标签用 color: #e2a090 */
```

### 安全框 (safe-box)（v2.0 新增）
```css
border-left: 4px solid #7aad5a;
padding: 5mm 6mm;
background: rgba(74,122,58,0.06);
color: #a0c490;
font-size: 15pt;
line-height: 1.9;
```

### 洞察框 (insight-box)（v2.0 新增）
```css
border-left: 4px solid #5a8aad;
padding: 5mm 6mm;
background: rgba(90,138,173,0.08);
font-size: 15pt;
line-height: 1.9;
/* strong 标签用 color: #5a8aad */
```

### 总览卡片网格 (overview-grid)（v2.0 新增）
```css
.overview-grid { display: flex; flex-wrap: wrap; gap: 3mm; }
.overview-card {
  background: #1e1a10; border: 0.5px solid #2a2515;
  border-radius: 3px; padding: 4mm 5mm;
  text-align: center; flex: 1 1 30mm; min-width: 30mm;
}
.overview-card .num { font-family: Noto Serif SC; font-weight: 700; font-size: 20pt; }
.overview-card .label { font-size: 9pt; color: #6b6040; }
```
数值颜色按含义选用功能色：正面用 `#7aad5a`，负面用 `#c25a4a`，中性用 `#e2c97e`，分析用 `#5a8aad`。

### 主题卡片 (theme-card)（v2.0 新增）
```css
.theme-card {
  background: #1e1a10; border: 0.5px solid #2a2515;
  border-radius: 3px; padding: 4mm 5mm; margin-bottom: 3mm;
  page-break-inside: avoid;
}
.theme-name { font-weight: 700; font-size: 15pt; color: #e2c97e; }
.theme-count { font-size: 11pt; color: #6b6040; }
.theme-quote {
  font-size: 12pt; color: #a09880;
  border-left: 2px solid #3a3520; padding-left: 4mm;
}
```

### 制作人引言 (producer-quote)
```css
font-family: Noto Serif CJK SC, serif;
font-size: 15pt;
color: #e2c97e;
text-align: center;
line-height: 2.2;
```

### 装饰菱形 (deco-diamond)
```
text-align: center; color: #3a3520; font-size: 10pt; letter-spacing: 6pt;
内容：◇ ◇ ◇
```

-----

## 封面规范（v2.0 细化）

```css
.cover { text-align: center; padding: 80px 0 50px; page-break-after: always; }
.cover-label { font-weight: 300; font-size: 11pt; color: #6b6040; letter-spacing: 6pt; }
.cover h1 { font-family: Noto Serif SC; font-weight: 700; font-size: 32pt; color: #e2c97e; letter-spacing: 3pt; }
.cover-sub { font-size: 14pt; color: #8a7a48; letter-spacing: 1pt; }
.cover-line { width: 60px; height: 2px; background: #c5a356; margin: 30px auto; }
.cover-meta { font-size: 11pt; color: #5a5540; line-height: 2.2; }
```

封面结构自上而下：标签（REPORT TYPE） → 主标题 → 装饰线 → 副标题 → 元信息（数据来源/时间/作者）

-----

## PDF 生成

**首选 weasyprint**：HTML → PDF 路径最可控。CSS @page 规则直接生效，不需要手动处理字体注册和页面回调。

```python
from weasyprint import HTML
HTML('report.html').write_pdf('output.pdf')
```

HTML 使用 Google Fonts CDN 加载 Noto Sans SC / Noto Serif SC。单文件自包含（CSS 内嵌）。

**reportlab 仅在需要程序化动态生成时使用。** 注意事项：
1. OTC 字体不可用，必须使用 .otf 或 .ttf 单体文件
2. Variable Font 需用 fonttools.varLib.mutator 生成静态字重实例
3. 深色背景需在 onPage 回调中手动绘制全页矩形

-----

## HTML 交付物规范

- 使用 Google Fonts CDN 加载 Noto Sans SC / Noto Serif SC
- 单文件自包含（CSS 内嵌，不外联样式表）
- 深色背景 `#0a0b10` 直接设在 body
- 交互元素用 vanilla JS，不依赖框架
- 卡片底色用 `#1e1a10`（暖棕黑），悬停用 `#241f14`
- 边框用 `#2a2515`，激活态用对应主题色 + 40% 透明度

-----

## PPT 规范

- 纯黑背景 `#0a0b10`
- 标题字体 Georgia serif（PPT 环境下的 Noto Serif 替代）
- 配色层级：亮金 `#e2c97e` 标题 → 主金 `#c5a356` 强调 → 暖米 `#f0ebe0` 正文 → 暗米 `#b5aa98` 辅助
- 一页一主题，大量留白
- 不使用渐变、阴影、动画转场

-----

## 禁止事项

- 不使用 emoji（任何交付物）
- 不使用冷色调背景
- 不使用细字重标题（Light / Thin）
- 不使用默认白底黑字
- 不使用系统字体（Arial、Helvetica、SimSun）
- 不使用 bullet point 圆点（用 ◆ 替代）

-----

## 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026.03.28 | 初版，基于架构文档实战经验 |
| v2.0 | 2026.03.29 | 正文字号 14.5→15pt，表格 12.5→13pt，表格正文字重 Regular→Medium，新增功能色（红/绿/蓝），新增 risk-box/safe-box/insight-box/overview-grid/theme-card 组件，细化封面规范，明确 weasyprint 为首选 PDF 工具 |

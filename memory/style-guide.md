# 交付物视觉规范 / Deliverable Style Guide

> 本文件是所有交付物（PDF、HTML、PPT）的视觉规范基线。
> 所有 claude.ai 和 Code 会话生成文档时，请先阅读本文件。

-----

## 核心美学关键词

**苹果官网布局**：大量留白、大标题居中、一屏一主题、呼吸感强、排版驱动。
**手机阅读优先**：正文 ≥ 14.5pt，辅助文字 ≥ 11pt，表格 ≥ 12pt。

-----

## 调色板

|用途    |色值                     |说明              |
|------|-----------------------|----------------|
|背景    |`#0a0b10`              |深黑底，所有交付物统一     |
|主金    |`#c5a356`              |标题装饰线、按钮、强调边框   |
|亮金    |`#e2c97e`              |章节标题、高亮文字、关键词   |
|暗金    |`#8a7a48`              |辅助标注、列表符号、表格注释  |
|正文    |`#d4c9a8`              |正文文字            |
|辅助文字  |`#6b6040`              |页码、注释、签名、英文副标题  |
|暗辅助   |`#5a5540`              |更低层级的辅助信息       |
|卡片/表头底|`#1e1a10`              |暖棕黑，表头背景、卡片底色   |
|边框    |`#2a2515`              |表格边框、分隔线        |
|装饰线   |`#3a3520`              |低对比度装饰线、引用框边    |
|高亮框底  |`rgba(197,163,86,0.06)`|highlight-box 背景|
|偶数行底  |`rgba(197,163,86,0.04)`|表格斑马纹           |

**绝对禁止**：冷蓝黑（如 `#12131c`）、纯白、纯灰、任何非暖色调的中性色。所有灰色必须偏暖偏棕。

-----

## 字体

|用途     |字体                               |字重                          |最小字号  |
|-------|---------------------------------|----------------------------|------|
|章节标题   |Noto Serif CJK SC / Noto Serif SC|SemiBold (600) 或 Bold (700) |22pt  |
|h3 小标题 |Noto Sans CJK SC                 |Bold (700)                  |16pt  |
|正文     |Noto Sans CJK SC                 |Medium (500) 或 Regular (400)|14.5pt|
|表格内容   |Noto Sans CJK SC                 |Regular (400)               |12.5pt|
|表头     |Noto Sans CJK SC                 |Bold (700)                  |13pt  |
|页码/注释  |Noto Sans CJK SC                 |Regular (400)               |10pt  |
|封面主标题  |Noto Serif CJK SC                |Bold (700)                  |30pt  |
|封面英文副标题|Noto Sans CJK SC                 |Light (300)                 |11pt  |

**关键原则**：必须用粗字重。Regular 仅用于正文和表格，标题和强调处永远用 SemiBold 或 Bold。细字重在深色背景上可读性极差。

-----

## 布局原则

- **一屏一主题**：每个章节 page-break-before: always
- **行高 2.0**：正文 line-height: 2，表格 line-height: 1.8
- **页边距**：A4 页面 18mm 上左右，16mm 下
- **段落间距**：4mm margin-bottom
- **列表缩进**：6mm padding-left，列表项前用 ◆（`#c5a356`，7pt）
- **章节标题与正文间距**：标题 margin-bottom 2mm + section-rule margin-bottom 5mm
- **避免孤页**：orphans: 3, widows: 3，关键区块 page-break-inside: avoid
- **对齐**：正文 text-align: justify，标题和引用 text-align: center

-----

## 表格规范

```css
table { width: 100%; border-collapse: collapse; font-size: 12.5pt; }
th { background: #1e1a10; color: #e2c97e; font-weight: 700; padding: 9px 10px; border: 0.5px solid #3a3520; }
td { padding: 8px 10px; border: 0.5px solid #2a2515; color: #c0b490; vertical-align: top; line-height: 1.8; }
tr:nth-child(even) td { background: rgba(197,163,86,0.04); }
tr:nth-child(odd) td { background: rgba(10,11,16,0.5); }
td b { color: #e2c97e; }
```

- 表格内长文本**必须用 Paragraph 对象**（reportlab）或正常 `<td>` 文本流（HTML），确保自动换行
- 避免表格 page-break-inside: avoid（可能导致孤页），允许表格跨页
- 表格注释用 `.table-caption`：11pt，`#6b6040`，居中，letter-spacing 1pt

-----

## 特殊组件

### 高亮框 (highlight-box)

```css
border-left: 4px solid #c5a356;
padding: 5mm 6mm;
background: rgba(197,163,86,0.06);
color: #e2c97e;
font-weight: 500;
```

### 制作人引言 (producer-quote)

```css
font-family: 'Noto Serif CJK SC', serif;
font-size: 15pt; /* 关键语句可放大到 20pt */
color: #e2c97e;
text-align: center;
line-height: 2.2;
```

### Claude 自述 (claude-voice)

```css
border-left: 3px solid #3a3520;
padding: 4mm 6mm;
background: rgba(197,163,86,0.03);
color: #b0a880;
font-size: 14pt;
```

### 装饰菱形 (deco-diamond)

```
text-align: center; color: #3a3520; font-size: 10pt; letter-spacing: 6pt;
内容：◇ ◇ ◇
```

-----

## reportlab 技术坑（PDF 生成）

1. **OTC 字体不可用**：Noto Sans CJK SC 的 `.otc` 格式 reportlab 无法加载。必须使用 `.otf` 或 `.ttf` 单体文件。
1. **Variable Font 需实例化**：Noto Sans SC Variable Font 必须用 `fonttools.varLib.mutator` 从 variable font 生成静态字重实例（如 Medium 500、Bold 700），然后注册为独立字体名。
1. **深色背景回调**：reportlab 默认白色页面背景。需要在 `onPage` 或 `onPageTemplate` 回调中手动绘制 `#0a0b10` 全页矩形作为底色。
1. **推荐用 weasyprint 替代 reportlab**：HTML → PDF 的路径更可控，CSS 样式直接生效，不需要手动处理字体注册和页面回调。当前项目文档均使用 weasyprint 生成。

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

> 本规范由 claude.ai 战略参谋会话基于实战迭代经验总结，v1.0，2026.03.28。

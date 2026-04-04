# QA 追踪报告格式规范

## 用途

从 Discord 社区数据中提取 bug 报告，按 QA 定位跟进格式输出 PDF。

## 数据来源

- `projects/news/data/discord/channels/23564288/` — #有問必答┊official-q-a
- 工单频道、多语言聊天区中的 bug 关键词命中

## 报告结构

### 封面
- 标题、副标题、数据范围、bug 总数（按优先级拆分）、报告日期

### Bug 索引表
- 编号、优先级、标题、状态（NEW/处理中/已回答）、平台、影响面
- 便于 QA 团队一览全局、分配跟进

### 每条 Bug 的标准字段

| 字段 | 说明 |
|------|------|
| **问题概括** | 一句话描述 bug 本质 |
| **复现步骤** | 有序列表，精确到操作 |
| **实际结果** | 红色左边框，写明玩家看到了什么 |
| **预期结果** | 绿色左边框，写明应该看到什么 |
| **影响分析** | 灰色底色块，包含：影响面（多少人确认）、严重度、是否有 workaround、与其他 bug 的关联性 |
| **附件** | 截图/录屏文件名和大小 |
| **来源** | 频道名、报告者 Discord ID、日期、确认者列表 |

### 优先级定义

| 等级 | 颜色 | 含义 |
|------|------|------|
| P1 | #c25a4a 红 | 阻断性：无法登录、闪退、冻结 |
| P2 | #c5a356 金 | 重要：核心战斗数值错误、角色机制失效 |
| P3 | #5a8aad 蓝 | 一般：UI 问题、小众配队、文案 |
| BAL | #7aad5a 绿 | 平衡/设计：非 bug 但需评估的数值反馈 |

### 状态标签

| 标签 | 颜色 | 含义 |
|------|------|------|
| NEW | 红底 | 社区报告，官方未受理 |
| 处理中 | 金底 | 官方已标记💭处理中 |
| 已回答 | 绿底 | 官方已标记✅已回答 |

### 根因关联分析

当多个 bug 疑似同一底层问题时，在索引表后用 insight-box 标注关联关系，建议合并为一个 ticket 排查。

## 视觉规范

遵循 `memory/style-guide.md`：
- 背景 #0a0b10，主色 #c5a356，正文 #e8e0d0
- Noto Serif CJK SC 标题，Noto Sans CJK SC 正文
- weasyprint 生成 PDF

## 模板文件

`projects/news/report-system/templates/qa-tracking-template.html`

## 生成方式

```python
from weasyprint import HTML
HTML('qa_report.html').write_pdf('output.pdf')
```

## 关键词扫描列表

用于从 JSONL 中筛选 bug 相关消息：

```
英文: bug, glitch, broken, crash, stuck, not work, doesn't work, error, fix, bugged, freeze, lag
中文: bug, BUG, 卡住, 闪退, 崩溃, 不生效, 没触发, 不触发, 无法, 错误, 异常, 修复, 黑屏, 白屏, 卡死, 进不去, 登不上, 打不开, 问题
韩文: 버그, 오류, 안됨, 안돼, 발동안, 작동
俄文: не работа
西文: no funciona
越文: không hoạt
泰文: ไม่ทำงาน
印尼: tidak bisa
```

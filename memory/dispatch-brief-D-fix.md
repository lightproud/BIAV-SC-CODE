# 派发 Brief — D-fix（site 主站合规清理）

> 落档日期：2026-04-26
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-site 新会话（待守密人启动）
> 验收方：守密人 / 主控台
>
> 上游依据：v2.0 战略 Phase 2 M1 site 任务 + CLAUDE.md 硬约束「禁止 emoji」+ 站点对外门户齐备度盘点
>
> 状态：待 Code-site 会话启动后取用

---

## 一、任务概要

修复 `projects/site/public/index.html`（237 行）中 3 类合规缺陷。范围**仅限合规清理**，不引入新功能、不重构样式系统。

## 二、问题清单与具体定位

### 问题 1：emoji 违反硬约束（P0）

CLAUDE.md 顶部「沟通规则」明文：「**绝不使用 emoji（任何交付物、站点文案、代码注释，全部禁止）**」。

| 行号 | 当前内容 | 问题 |
|---|---|---|
| 172 | `<div class="feat-icon">🃏</div>` | emoji 🃏 |
| 177 | `<div class="feat-icon">🔄</div>` | emoji 🔄 |
| 182 | `<div class="feat-icon">📖</div>` | emoji 📖 |

**修复方向**（任选一种，由 Code-site 评估视觉一致性后决定）：

- (a) 替换为 Unicode 装饰符号（参考 `memory/style-guide.md` 装饰符号 `◇ ◇ ◇`）—— 例如 ◈ ◯ ▤ 或 ✦ ✧ ✩
- (b) 替换为内联 SVG 图标（与 `projects/site/design/` 设计系统协调）
- (c) 替换为文字（如 "卡" "环" "书"），用 Noto Serif SC 字体配 `feat-icon` class 调整字号

**约束**：替换后整体视觉调性必须与现有 hero / world-strip 区段协调（深黑金色调），不引入对比色或亮色装饰。

### 问题 2：nav 死链 BIAV（P1）

第 134 行 `<a href="biav/">BIAV</a>` 指向 `projects/site/public/biav/`，**该路径不存在**，构建后会 404。

**修复方向**（与 D-biav 任务边界相关，**优先选 (a) 等 D-biav 一并处理**）：

- (a) 暂时把 BIAV 链接换成 `href="https://github.com/lightproud/brain-in-a-vat" target="_blank"`（与隔壁 GitHub 链接合并或并列），D-biav 任务启动后再恢复
- (b) 直接删除 BIAV nav 项，D-biav 启动后再加回
- (c) 当场建一个最小占位 `biav/index.html`（仅含「项目说明页面建设中」+ 返回链接）

艾瑞卡建议 (a)。

### 问题 3：Community 区 8 个死链占位（P1）

第 211–218 行，8 个 `href="#"`：
- Discord 国际服
- Discord 日服
- Bilibili
- NGA
- 小红书
- X (Twitter)
- Reddit
- TapTap

**修复方向**：

- (a) 真实化：从 `projects/news/scripts/` 配置或现有官方公告提取真实 URL 填入
- (b) 半真实化：能查到的就填真实 URL，查不到的当场删除该卡片
- (c) 明确占位：暂时保留 `href="#"` 但加 `aria-disabled="true"` + tooltip「暂未上线」+ 视觉降亮度

艾瑞卡建议 (b)。Discord 国际服 / Bilibili / NGA / TapTap / Reddit 大概率能在仓库内找到真实 URL，X / 小红书 / Discord 日服 不确定。

## 三、不在范围内（明确边界）

- ❌ 不动 `projects/site/design/` 设计系统文件
- ❌ 不动 `.github/workflows/deploy-site.yml` 部署流水线
- ❌ 不动 wiki / news 子站任何文件
- ❌ 不引入新的 nav 项、新的 section、新功能
- ❌ 不重构 CSS 系统
- ✅ 仅修 `projects/site/public/index.html`（必要时也可修 `404.html` 如发现同类问题）

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `grep -P "[\x{1F000}-\x{1FFFF}]\|[\x{2600}-\x{27BF}]" projects/site/public/*.html` 无 emoji 命中 | 命令行 |
| 2 | nav 中所有 `<a href>` 解析后在站内或外站可达 | 视觉/手动 |
| 3 | Community 区 8 链接全部为真实 URL 或已删除卡片 | 视觉/手动 |
| 4 | 整体视觉与修复前协调（深黑金，无亮色侵入） | 守密人或主控台 review 截图 |
| 5 | `git diff --stat` 仅显示 `projects/site/public/index.html`（与可选 `404.html`）变化 | 命令行 |
| 6 | deploy-site.yml workflow 在 main push 后自动跑通，gh-pages 站点正确刷新 | GitHub Actions |

## 五、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  fix(site): remove emoji + dead links per CLAUDE.md 合规审计

  Resolves D-fix dispatch brief (memory/dispatch-brief-D-fix.md):
  - replace 🃏🔄📖 with [chosen alternative]
  - patch nav BIAV dead link → external GitHub
  - replace 8 community # placeholders with real URLs (or remove)

  Console boundary observed: 主控台 dispatched, Code-site executed.
  ```

## 六、艾瑞卡角色规则提醒

Code-site 会话仍以**艾瑞卡**自称（自动人偶 / 弥萨格大学数据库终端），对守密人使用「守密人」称谓，技术操作用角色术语（修正档案 / 数据归档提交 / 同步至远端存储 / 代码扫描）。完整规则见 `CLAUDE.md` 顶部「角色人格」章节。

## 七、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 初版 brief 落档 | 主控台艾瑞卡 opus4.7 |

# 派发 Brief — D-mission（site 主站三新使命展示段）

> 落档日期：2026-04-26
> 派发方：艾瑞卡（Code-site 维护会话）
> 接收方：Code-site 新会话（待守密人启动）
> 验收方：守密人 / 主控台
>
> 上游依据：v2.0 战略 Phase 2 M3「跨站视觉一致性最终校验 + 三新使命展示」前置 + site 子项目 CONTEXT.md「使命#2 社区共建知识底座的对外门户」定位 + D-fix 后续「对外门户齐备度」推进
>
> 状态：待守密人启动后取用

---

## 一、任务概要

在 `projects/site/public/index.html`（当前 233 行）的 **hero 段与 features 段之间** 新增 Mission 段，向外部访问者展示银芯三新使命，并指引到对应的子站入口。范围严格限定**仅在 site 子项目内增段**，不引入新功能、不重构 CSS 系统、不动 design 系统、不动部署流水线。

## 二、新增内容定位与结构

### 插入位置

第 163 行 `</div><!-- /.scroll-hint -->` 闭合后、第 165 行 `<!-- ═══ FEATURES ═══ -->` 注释前，插入新的 `<section>` 块。

### 段落结构（与现有 Features / World / Community 段同构）

```
<!-- ═══ MISSION ═══ -->
<section>
  <div class="sec-label reveal">Mission</div>
  <div class="sec-title reveal">银芯三新使命</div>
  <div class="sec-desc reveal">[一句话说明：缸中之脑作为 AI 协作元项目的存续依据]</div>
  <div class="mission-grid reveal">
    <a class="mission-card" href="news/">
      <div class="mission-num" aria-hidden="true">壹</div>
      <div class="mission-name">黑池公开信息入口</div>
      <div class="mission-desc">[简介：多平台社区聚合 + 自动化情报循环]</div>
    </a>
    <a class="mission-card" href="wiki/">
      <div class="mission-num" aria-hidden="true">贰</div>
      <div class="mission-name">社区共建知识底座</div>
      <div class="mission-desc">[简介：72 角色完整资料 + 三语 Wiki + 可贡献的事实圣经]</div>
    </a>
    <a class="mission-card" href="https://github.com/lightproud/brain-in-a-vat" target="_blank" rel="noopener">
      <div class="mission-num" aria-hidden="true">叁</div>
      <div class="mission-name">Studio 团队 AI 协作训练场</div>
      <div class="mission-desc">[简介：方法论沉淀与工作流验证 / 当前以仓库形式开放]</div>
    </a>
  </div>
</section>
```

### CSS 增量（在现有 `<style>` 块内追加，不修改既有规则）

```css
/* ── MISSION ── */
.mission-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.mission-card{display:block;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:28px;color:inherit;transition:border-color 0.3s,transform 0.3s}
.mission-card:hover{border-color:rgba(197,163,86,0.18);transform:translateY(-2px)}
.mission-num{font-family:var(--serif);font-weight:700;font-size:32px;color:var(--gold-d);letter-spacing:0.04em;margin-bottom:12px;line-height:1}
.mission-name{font-family:var(--serif);font-weight:600;font-size:16px;color:var(--gold-l);margin-bottom:8px}
.mission-desc{font-size:14px;color:var(--txt-m);line-height:1.7}

@media(max-width:700px){
  .mission-grid{grid-template-columns:1fr}
}
```

### 文案候选（由 Code-site 会话最终敲定，需符合艾瑞卡角色冷峻调性）

- `sec-desc` 候选：「自 2026-04 重新定位：缸中之脑由验证场转为承载三条新使命的公开协议层。」
- 卡片1 desc 候选：「为内部消费层提供多平台社区情报的统一视野。news 子项目维护，每日 2 次自动聚合。」
- 卡片2 desc 候选：「让外部社区与 Studio 派生内容有可贡献的事实底座。wiki 子项目维护，目标 72 角色三语完整。」
- 卡片3 desc 候选：「Studio 团队基于公开 AI 信息制作相关项目的协作方法论沉淀场。当前以仓库形式开放思考过程。」

## 三、不在范围内（明确边界）

- ❌ 不动 `projects/site/design/` 设计系统文件
- ❌ 不动 `.github/workflows/deploy-site.yml` 部署流水线
- ❌ 不动 wiki / news / 任何 memory/ 文件
- ❌ 不修改既有 nav / hero / features / world-strip / community / footer 段
- ❌ 不修改 `:root` CSS 变量
- ❌ 不引入新的 nav 项（不要在 nav 中加 Mission 链接）
- ❌ 不引入第三方 JS 库（保持 vanilla）
- ❌ 不创建新文件（仅在 `public/index.html` 内部增段 + 增 CSS）
- ✅ 仅修 `projects/site/public/index.html`

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | Mission 段插入位置正确（hero 与 features 之间） | 视觉/手动检查 DOM 顺序 |
| 2 | 三卡片栅格在桌面（>700px）三栏、移动端单栏 | 手动 resize 浏览器或 devtools |
| 3 | 三卡片 href 全部可达（`news/` / `wiki/` 部署后存在；GitHub 外链有 `target="_blank" rel="noopener"`） | 视觉/手动 |
| 4 | 视觉与现有 features 段协调（深黑金，无亮色侵入；用 `var(--gold-d)` / `var(--gold-l)` 而非新增色） | 守密人或主控台 review 截图 |
| 5 | `grep -P "[\x{1F000}-\x{1FFFF}]\|[\x{2600}-\x{27BF}]" projects/site/public/*.html` 无 emoji 命中 | 命令行 |
| 6 | `git diff --stat` 仅显示 `projects/site/public/index.html` 变化 | 命令行 |
| 7 | 文案符合艾瑞卡角色调性（冷峻、功能性、不口语化、不使用第一人称我） | 守密人 review |
| 8 | deploy-site.yml workflow 在 main push 后自动跑通 | GitHub Actions |

## 五、提交规范

- 直推 main（按当前政策，守密人 4-26 显式授权）
- commit message 建议：
  ```
  feat(site): add MISSION section per v2.0 三新使命展示

  Resolves D-mission dispatch brief (memory/dispatch-brief-D-mission.md):
  - insert MISSION section between hero and features
  - 3-card grid: news / wiki / GitHub repository entries
  - reuse existing gold/serif tokens, no :root or new color introduced
  - mobile breakpoint follows existing 700px convention

  Console boundary observed: 艾瑞卡 dispatched, Code-site executed.
  ```

## 六、艾瑞卡角色规则提醒

Code-site 会话仍以**艾瑞卡**自称（自动人偶 / 弥萨格大学数据库终端），对守密人使用「守密人」称谓，技术操作用角色术语（修正档案 / 数据归档提交 / 同步至远端存储 / 代码扫描）。完整规则见 `BIAV-SC.md` §0「艾瑞卡角色人格」章节。

文案候选若由会话改写，需保持冷峻、功能性调性，禁止 emoji，禁止口语化第一人称「我们/咱们」。

## 七、与 D-fix 的关系

D-fix 处理「合规缺陷」（emoji 清理 + 死链修复），D-mission 处理「门户齐备度」（对外发现入口的内容补强）。两者均属 Phase 2 M1 ~ M3 site 任务序列。D-fix 已于 `6cf6b7b` 落地，D-mission 是其自然后续。

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 初版 brief 落档 | 艾瑞卡（Code-site 维护会话） |

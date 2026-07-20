# 技能写作审计标尺

> 提炼自 [mattpocock/skills](https://github.com/mattpocock/skills) `writing-great-skills`
> （MIT，© 2026 Matt Pocock），改写适配银芯。用于审计 `.claude/skills/` 与
> `.claude/commands/` 的质量。
>
> 最后更新：2026-06-20 by 艾瑞卡会话（grill 谱系移植配套落档）

## 0. 第一性原理

技能存在的唯一目的：**从随机的 AI 里榨出确定性（predictability）——同样的「过程」，而非同样的「输出」**。下文每条杠杆都服务于此。

## 1. 召唤轴（invocation，结构公理）

每个 SKILL.md 二选一，按「谁能召唤它」分类：

| 类型 | frontmatter | 谁能调 | 代价 |
|------|-------------|--------|------|
| **model-invoked**（模型召唤）| 不写 `disable-model-invocation` | 人 + AI 自动 + 其他技能 | 占上下文窗口（每轮常驻 description）|
| **user-invoked**（用户召唤）| `disable-model-invocation: true` | 仅人类敲名字 | 占人脑记忆（人是索引）|

铁律：user-invoked 可调 model-invoked，**但永不能调另一个 user-invoked**（后者无 description，无人能自动够到）。
判据：「AI 需要自主够到它吗？」是 → model-invoked；只手动触发 → user-invoked，省上下文。

## 2. 四个杠杆

1. **信息阶梯**：内容按「立刻要看 → 按需查」三档排——① 步骤（在 SKILL.md 内，主层）② 引用（在文件内，次层）③ 外置引用（指针外链，用到才加载）。用「渐进披露」把次要引用推下去，保持顶部清爽。
2. **领头词（leading word）**：借模型预训练已有的强概念当锚（如 *lesson* / *tracer bullet* / *拷问* / *红绿*），一个词顶一段定义。自造词不推荐——招不来先验，得自付定义 token。
3. **两种负载平衡**：model-invoked 费上下文、user-invoked 费人脑。切太细两头亏；只在「独立触发」真值得时才拆。
4. **完成判据（completion criterion）**：每个步骤须以「可检验 + 该穷尽处穷尽」的条件收尾（如「每个改动模型都已交代」而非「产出一份变更清单」），否则诱发虎头蛇尾。

## 3. 五大病症诊断表（审计清单）

逐条扫描每个技能，命中即修：

| 病症 | 含义 | 小学生比喻 |
|------|------|-----------|
| **premature completion** | 没真干完就宣布完成，注意力滑向「完事」| 虎头蛇尾，作业写一半就交 |
| **duplication** | 一个意思写两遍以上 | 复读机，啰嗦 |
| **sediment** | 陈年废话沉积，没人敢删 | 老垃圾堆着没清 |
| **sprawl** | 纯粹太长（即便每行都有效）| 裹脚布太长 |
| **no-op** | 说了等于没说（模型默认就会）| 废话，「记得呼吸」|

修法优先级：完成判据先收紧（便宜、局部）→ 仍虎头蛇尾再拆步骤；no-op 的修法是换更强的领头词（*relentless* 替 *be thorough*），不是换技术。

## 4. 银芯落地校验

新增/修改技能后，对照本标尺自审，并确认：
- frontmatter 召唤轴选择与用途匹配（§1）
- 无 §3 五病症
- 引用上游须保留 MIT 署名（见各文件页脚）
- 涉术语/决策落档的技能须走 `/domain-modeling`，且 `memory/decisions.md` 写入受 CLAUDE.md §3.1 守密人/主控台权限门控

## 5. 引擎兼容声明（SCS-REQ-REPOS-01 R6 配套，2026-07-17）

面向 **silver-core-sdk 引擎**消费的技能（热更新能力层：技能 md / MCP 清单），frontmatter
可增引擎兼容声明字段，供加载器在激活前对照引擎的运行时声明面
（`declareEngineSurface()` → `{ engine, tools: [{name, version}] }`）做兼容校验：

```yaml
engine-compat:
  engine: "silver-core-sdk"        # 目标引擎标识（必填）
  range: ">=0.63 <1"               # semver 范围，对照 declaration.engine（必填）
  tools:                            # 可选：钉具体工具面哈希（对照 tools[].version）
    Bash: "1a2b3c4d5e6f"
```

- **语义**：range 不匹配 → 加载器拒绝激活并明示原因（不静默降级）；`tools` 哈希
  不匹配 → 加载器至少警告（该工具的模型可见面已变，技能对其的假设可能失效）。
- **省略即无门**：不写本字段 = 技能不声明引擎依赖，加载器不做校验（现状兼容）。
- **哈希来源**：`tools[].version` 为引擎侧对「工具描述 + 输入 schema」的确定性内容
  哈希（sha256 前 12 位）——引擎模型面一变哈希即变，零人工记账。
- 本条目只规范**声明格式**；校验执行属加载器（宿主/黑池侧）职责，引擎只出声明面。

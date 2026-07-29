# SCS-REQ 输入形状诊断（input-shape diagnostics）· 调查报告 + 需求裁定书

- 日期：2026-07-29（北京时间）
- 来源：守密人截图报症（黑池 BPT 会话，`D:/BIAV-BP/bpt-dev/scripts/structure-gate.mjs`），
  问「这是银芯的 bug 吗」
- 裁定：守密人 2026-07-29 交互裁「两条都做」（诊断增强 ①+②）
- 落地版本：silver-core-agent-sdk **2.2.1**（maestro 2.2.1 锁步对齐，零代码改动；原拟 2.1.1，rebase 时家族钟已被 #881 推进 2.2.0 故顺延）
- 状态：SHIPPED（本档为调查溯源 + 黑池侧验证指引，实现细节以 CHANGELOG 2.2.1 为权威）

## 一、症状（黑池现场）

1. SDK 提供的 Edit 工具连续多次失败，报错恒为
   `Edit failed: "old_string" must be a string.`；
   模型换用多个不同 old_string 重试均同错，自判「工具层暂时故障」，
   最终改用 Write 整文件替换绕过。
2. 同会话 memory 工具报
   `Error: /memories/pitfalls is outside the memory areas mounted for this session.
   Accessible mounts: /memories/team (read-only), /memories/personal (read-write)`。
3. 黑池 pitfalls 记忆中已有此坑记录与「已知解法」——复发多次的结构性问题。

## 二、调查判定（银芯侧证据链）

**结论：两个报错都不是银芯 SDK 的缺陷；SDK 侧行为全部按设计工作。**

1. **报错点是正确的门卫**（`src/tools/edit.ts`）：校验顺序 file_path 先、old_string 后；
   报错停在 old_string 一步 ⇒ 到达工具的 input **有 file_path、缺 old_string**，
   且是合法解析后的 JSON 对象。
2. **SDK 流拼装层不可能产出这种输入**（`src/engine/accumulator.ts`）：
   工具参数 JSON 在传输中被截断时——0.63.1（2026-07-17，T49 batch B / H4）之前直接抛协议错
   炸整轮；0.63.1 起打「不可执行」标记、以 `error_code: 'tool_input_truncated'` 拒绝执行。
   两代行为都绝不把缺了一半的参数交给工具。OpenAI 网关臂（`src/transport/openai.ts`）
   对 arguments 原样逐字拼接进同一条校验路径，SDK 不做任何「JSON 修补」。
3. **头号嫌疑 = 宿主侧 PreToolUse 钩子（或 canUseTool）的 `updatedInput` 整体替换误用**：
   SDK 按官方语义实现（`src/hooks/runner.ts` + `src/permissions/gate.ts`）——
   `updatedInput` **整体替换**原参数、不是合并。若黑池钩子做路径规范化、只回传
   `{file_path: 规范化路径}`，其余字段精确蒸发。
4. **四个现场特征全部吻合**：
   - 截图 file_path 为正斜杠 `D:/...`（Windows 原生反斜杠）——确有环节在改写路径；
   - 「多个不同 old_string 均同错」——丢字段与内容无关，症状稳定；
   - Read 一路正常（单必填字段，被替换成 path-only 无损）而 Edit 必炸（三必填字段）；
   - 黑池坑记录「已有解法」——结构性复发，非网络抖动。
5. **memory 报错为设计内行为**（`src/tools/memory/mounts.ts`）：会话只挂
   `/memories/team`（只读）+ `/memories/personal`（读写），访问第三区域被正确拒绝
   并列出可用挂载；截图中模型随后自行修正路径读到坑记录。非缺陷。

## 三、黑池侧验证一步（待黑池执行）

检查 BPT 的 PreToolUse 钩子 / canUseTool 回调是否对 Edit 返回 `updatedInput`：
**临时禁用该钩子重试一次 Edit** 即可分辨。

- 若禁用后 Edit 恢复正常 ⇒ 修法 = 钩子改回传**完整 input**（在完整对象上应用改动），
  而非只回传改过的字段（`updatedInput` 是 replace 不是 merge）。
- 若禁用后仍炸 ⇒ 下一嫌疑人为网关侧参数重写，回报银芯继续排查。
- 升级 pin 至 ≥2.2.1 后，两条新诊断（见下）会把此类故障直接点名，无需盲试。

## 四、已落地的两条诊断增强（守密人裁定「两条都做」）

零行为变化，纯加诊断信息：

1. **Edit/Write 参数类型报错附实际收到的形状**（`fsutil.describeInputShape`，内部助手
   不入包根导出面）：历史文案前缀逐字保留（宿主既有字符串匹配不破），尾部括注追加
   缺席字段的种类（absent / undefined / null / an empty string / an array / an object /
   of type X）+ 收到的键清单（前 10 键 + `+N more`；**只给键名不给值**，防泄密）。
   示例：`Edit failed: "old_string" must be a string ("old_string" was absent;
   received input keys: ["file_path"]).`
2. **权限门点名丢必填键的改写方**：`gate.check` opts 新增诊断性 `requiredInputKeys`
   （tool-dispatch 只从**内建工具**一手 schema 提取；MCP 第三方 schema 的 required
   不可靠故跳过）。PreToolUse hook 与 canUseTool 两处 `updatedInput` 替换缝上，
   若模型确实发过的必填键在替换后消失，debug 日志点名改写方并明示
   「updatedInput REPLACES the input (it is not merged); return the FULL input」。
   模型本就没发的键不赖改写方；替换本身照旧生效。

回归锁定：`tests/input-shape-diagnostics.test.ts` 11 例；全量 3438 通过 + 6 skipped（2.1.1 树时点）。

## 五、档案时效订正（顺带）

CLAUDE.md §1.2「黑池 silver-core-sdk 0.3x pin」为 2026-07-12 旧记述；
2026-07-28/29 连续四版（0.94.0 / 0.97.0 / 1.4.1 / 2.1.0）均由黑池转派需求驱动，
黑池消费版本早已跟进。本档不改 CLAUDE.md（历史叙述保留），此处备注供后续对账。

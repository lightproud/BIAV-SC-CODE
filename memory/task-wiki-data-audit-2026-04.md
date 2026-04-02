# [Code-wiki] Wiki 数据准确性修正

> 最后更新：2026-04-02 by 战略中心（Code）
> 创建：2026-04-01 by 战略参谋
> 执行模式：直接执行
> 优先级：P1
> 数据来源：2026-04 制作人采访（`assets/data/interview-2026-04.json`）与现有数据库交叉审计

---

## 背景

战略参谋对 `projects/wiki/data/db/characters.json`（59 条角色记录）与制作人采访第一方陈述进行了交叉比对，发现以下 7 个数据问题。

## 修正清单

### 1. Helot 名称缺少后缀
- **文件**：`projects/wiki/data/db/characters.json`，id = `helot`
- **当前值**：`name: "血链·希洛"` / 英文名未知
- **正确值**：应为 **Helot: Catena**（或 "希洛: 血链"），采访中明确提到全名包含 ": Catena" 后缀
- **操作**：确认英文全名格式并更新 `name` 字段

### 2. 24 的领域标注不完整
- **文件**：`projects/wiki/data/db/characters.json`，id = `24`
- **当前值**：`realm: "chaos"`（仅混沌）
- **正确值**：采访明确说 24 是"四领域适性"角色，即 chaos/order/light/dark 四个领域均适用
- **操作**：更新 realm 或 realms 字段，标注四领域适性特殊机制

### 3. Ramona: Timeworn 获取方式标注缺失
- **文件**：`projects/wiki/data/db/characters.json`，id = `ramona-timeworn`
- **当前值**：`acquisition: null`
- **正确值**：采访明确说 Ramona: Timeworn 是**特殊获取**（非限定池，而是特定条件获取），与普通限定角色不同
- **操作**：添加 acquisition 信息，标注为特殊获取方式（非标准卡池）

### 4. Herbert 角色缺失
- **文件**：`projects/wiki/data/db/characters.json`
- **问题**：数据库中不存在 id 含 "herbert" 的角色
- **采访信息**：Herbert 在采访中被提及为已确认角色
- **操作**：如有公开信息，添加 Herbert 角色条目；如信息不足，在 `pending-discussions.md` 记录待补充

### 5. Juliette 角色缺失
- **文件**：`projects/wiki/data/db/characters.json`
- **问题**：数据库中不存在 id 含 "juliette" 的角色
- **采访信息**：Juliette 在采访中被提及
- **操作**：同 Herbert

### 6. 角色总数差异
- **当前数量**：59 个角色记录
- **采访提及**：制作人称"约 63 个角色"
- **差异**：4 个角色缺失（Herbert、Juliette 占 2 个，另 2 个待查）
- **操作**：与游戏内实际角色列表交叉比对，找出缺失角色并补充

### 7. Nautila 不在数据库中
- **文件**：`projects/wiki/data/db/characters.json`
- **问题**：采访中提及 Nautila 的个人线剧本已完成，但数据库中无此角色
- **操作**：确认 Nautila 的公开信息并添加条目（注意：可能是 id 使用了其他拼写，先搜索确认）

---

## 执行建议

1. 先处理确定性高的修正（#1 Helot 名称、#2 24 领域、#3 Ramona 获取方式）
2. 缺失角色（#4-7）需要额外数据源验证（游戏内截图、Fandom Wiki、Steam 商店页等），无法从采访单独确认的暂挂起
3. 修正后运行现有的数据校验脚本（如果有的话）
4. 每项修正在 commit message 中注明数据来源为 `interview-2026-04`

## 参考文件

- `assets/data/interview-2026-04.json` — 采访原始数据
- `assets/data/narrative-structure.json` — 叙事结构（含角色线信息）
- `assets/data/design-decisions.json` — 设计决策（含角色设计案例）

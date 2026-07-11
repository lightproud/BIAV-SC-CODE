# 记忆层全档案事实核对审计（2026-07-10）

> 执行：艾瑞卡记忆档案事实核对会话（守密人「也核对下所有记忆文件的事实」派单）。
> 方法：四簇并行只读扫描代理（①活状态档案 ②决策与踩坑日志 ③active hub 与机器台账
> ④专题参考档案），逐簇比对「档案断言 vs 仓库实况」，可安全修正项当场落盘、
> 裁定类遗留项挂账 `memory/todo.md`。
> 关联：CLAUDE.md 同日对账（同 PR #569）；decisions.md 维护授权条（同日，后续 PR）。

## 一、结论速览

- 覆盖：`memory/` 33 个根档案 + 4 个 active hub + research/ strategy/ archive/ 子目录，约 6,500 行。
- 发现漂移约 30 处；**可安全修正 25 处已全部落盘**（PR #569，14 档案 + CLAUDE.md 5 处）；
  decisions.md 6 处有效性误标经守密人同日「维护授权」后回指补注（后续 PR）。
- 引用完整性：**当前有效区无断裂活引用**——全部 MISSING 命中均属豁免类
  （历史横幅档 / gitignore 产物 / 更名旧称 / 已删子系统的历史追溯）。
- 病因五类：头部标记滞后 / 复刻数字失真 / 裁定回写不全 / 路径迁移断链 / 退役无横幅。
  前两类与后两类机器可拦截（约七成），第三类靠协议 + 节拍。

## 二、已修正清单（25 处，PR #569 合并 `58c3809`）

**CLAUDE.md（5）**：§1.4-2 wiki 数据桥现状（07-02 已接回）；§1.4-5 / §6.1「kb_* 四工具」→七工具（两处）；
§1.2 使命#2 语义收敛横幅；§1.3 维护态指针；§7.6 CI 硬门禁重启记录。

**project-status.md（5）**：头部日期 07-06→07-10；SDK 状态行 v0.12.0/1427→v0.42.0/1651；
Discord 源行改方案甲三服平级布局；数据源清单补 bahamut / note_com / arca_live；
06-09 核验节补历史快照标注（工作流 19→现 34）。

**active hub（5 档）**：mission hub 07-10 语义收敛横幅 + 核心交付 / M7 / 协议引用订正；
贡献 hub 补退役横幅（主档已有、hub 漏标）；直推政策卡时间线补 06-11 / 06-14+21 / 06-21 / 07-10 四段；
银芯-黑池接口卡补 OKF tarball 与 `silver-core-sdk-*.tgz` 两条单向输出线；todo T3 销账移入已清。

**专题档案（7）**：morimens-context 页脚 db/→processed/；repo-slimming 死引用标注（测量器已删）；
bpt-guidance-protocol 状态行 v0.4→v0.7；bpt-guidance-log 停更注脚；research/ 两份定日报告
superseded 横幅；contribution-protocol M1 行 bug/data-gap 模板 07-10 已删注。

**lessons-learned.md（1）**：头部「最后更新」#41→#47 对账（历史条目未动）。

**decisions.md（6，维护授权后回指补注）**：v2.0 巨条补使命#3 退役 + M7 作废回指；
零 ML 红线补 scoped 解除注；大二进制 Releases 条补 text 部分反转注；方案甲条覆盖列补登记
（落定 06-21 悬置布局）；子项目表 Discord 分级存储整条反转标注 + 归档 4 项部分失效标注。

## 三、遗留待裁项（挂账 `memory/todo.md` T16–T19）

| # | 事项 | 要点 |
|---|------|------|
| 1 | 孤儿与台账处置 | `memory/facts.json` 真孤儿（无活引用，内容停 2026-04，已删记忆子系统遗留）删除或归档；`memory/pending-discussions.md` 与 todo.md 双台账，归档降级或保留；`session-continuity.json` 数据 26 天未更新且含已删「做梦」主题，但 `current_continuity` MCP 工具仍读它——续维护或连工具退役 |
| 2 | 被覆盖设计档处置 | `memory/discord-archiver-design.md` 被三重覆盖（路径迁移 06-21 / text 回 git 06-21 / 方案甲 07-10），退役横幅归档或重写为现行设计（审计判「最重」）；`memory/storage-discussion.md` 议题已由 06-21 /grill 闭合，补 superseded 横幅或移 archive |
| 3 | wiki schema 落点 | `memory/wiki-characters-schema-v1.md` 产出落点仍指已清空的 `data/db/`——是否改指 `processed/characters.json` 作现行校验权威（涉 validate-data 校验口径） |
| 4 | lessons 编号 | #21 重复两用（物理 48 条 ≠ 最高号 47），是否重编（历史日志改号，默认不动） |

## 四、反漂移机制提案（守密人已阅，待开工裁定）

三层防线：①对账三卫扩编为记忆层全域卫（路径引用卫 + 头部新鲜度卫 + 生命周期状态卫，
pytest + CI 每 PR 拦截）；②复刻数字声明式对账表（「镜像 ↔ 权威源」注册表，仿 archive_sources
模式）+ 裁定落档协议补「回写足迹」硬规；③四簇审计固化为 `/audit-memory` 可重跑命令，
挂维护态月检。诚实边界：语义漂移（巨条子句未回指类）机器测不出，靠节拍收口。

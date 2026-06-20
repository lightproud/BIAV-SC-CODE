# 仓库瘦身方案（体量优化 + Releases 归档一体）

> 产出：2026-06-20 `/grill 优化银芯仓库` 拷问会话 B 分支（艾瑞卡）。
> 守密人逐分支裁定：优先维度 = git 健康；痛点 = 两者都要（A 分支 413 防护已落地，见
> pre-push 钩子）；体量瘦身代价 = 跟 Releases 内容一起考虑方案；fanart = 月归档 Releases。
>
> 本档案是方案与 runbook；决策摘要入 `memory/decisions.md`。

## 1. 体量诊断（2026-06-20 实测）

| 层 | 体量 | 占比 |
|----|------|------|
| `projects/news/data/discord/` | 3.1G | 工作树 ~81% |
| `projects/news/data/fanart/` | 588M | ~15% |
| `.git`（历史） | 1.1G | — |
| `assets/data/vectors.json.gz` | 8.7M | 已清（孤儿）|

> 比喻：行李箱 96% 重量来自聊天记录 + 同人图两个箱格。

## 2. 三资产处置裁定

| 资产 | 处置 | 依据 |
|------|------|------|
| Discord JSONL | git 留 60 天，每月 1 日打包旧月推 Releases + 删 git，日统计永久留 | **落实既有决策 179（2026-03-29），从未执行** |
| fanart | git 留近期（建议 30 天），月归档 Releases + 删 git，留 manifest 索引 | 守密人 2026-06-20 裁定（同 discord 模式）|
| vectors.json.gz | git rm + 修 gitignore 陈旧注释 | 语义检索 6-20 退役孤儿，**本会话已清** |

**不改写 git 历史**：filter-repo 重写全 SHA、强推 main、撞 main Ruleset 保护、破坏现有 clone 与采集机器人基线——排除。`.git` 1.1G 历史体积留待真成瓶颈再单独评估（延续决策 178 精神）。

## 3. 根因：缺归档基建

决策 179/199 立了「推 Releases」方案却**从未写归档脚本**（`grep releases/download|gh release` 全仓为空），这是两套决策全部落空、数据堆 git 的真因。瘦身的前提是先补这块基建。

> 比喻：定了「满 60 天送仓库」的规矩，却从没雇运货的车。

## 4. 归档脚本设计（待实现）

`projects/news/scripts/archive_to_releases.py`，discord 与 fanart 共用：

- **入参**：`--kind {discord|fanart}` `--month YYYY-MM` `--retention-days N` `--dry-run`
- **选月**：扫描 `channels/*/{date}.jsonl`（discord）或 `fanart/{date}/`（fanart），筛出早于 retention 窗口的整月数据。
- **打包**：`tar.gz` 按 `{kind}-{YYYY-MM}.tar.gz`。
- **上传**：`gh release upload archive-{kind}-{YYYY-MM} <tarball>`（tag 不存在则建）。**校验上传成功**（HTTP 200 + 远端字节数比对）后才进入删除步。
- **删 git**：上传校验通过后 `git rm` 该月原始文件，目录留 `MANIFEST.json`（含 Release tag/URL + 文件清单 + 条数），保证可溯源。
- **幂等**：已归档月（archive-log.json 有记录）跳过。
- **安全**：`--dry-run` 默认行为先验证选月与打包，不删不传；实删需显式 `--execute`。

## 5. Workflow（待守密人手动添加 —— lesson #38）

`.github/workflows/archive-monthly.yml`：`schedule` 每月 1 日 02:00 UTC + `workflow_dispatch`。

**硬约束**：Web 环境 git 凭据缺 `workflow` 权限，含 `.github/workflows/*.yml` 的推送被整单拒（lesson #38）。故此文件**艾瑞卡无法推送**，需守密人本地添加或在有 workflow 权限的通道提交。文件内容随实现一并提供。

## 6. 首次归档 runbook（不可逆，建议守密人盯）

1. `--dry-run` 跑 discord 全部超期月 + fanart 超期月，人工核对选月清单与打包体积。
2. 抽一个月 `--execute`，验证：Release 可下载、字节数一致、git 该月已删、MANIFEST 留存、`validate` 通过。
3. 确认无误后批量 `--execute` 其余月。
4. 复测 `du -sh projects/news/data`，确认体量下降。

**风险登记**：
- 删 git 不可逆——必须上传校验通过才删（脚本硬门）。
- §4.1 全量档案纪律由 Releases 接管保全，长窗口分析改从 Release 拉取。
- Releases 上传依赖 token 权限，云容器能否成功待首跑验证。

## 7. 落地批次

- **批 0（本会话已落）**：vectors 孤儿清理 + 本方案 + decisions.md 起草。
- **批 1**：实现 `archive_to_releases.py` + dry-run 验证（纯脚本，可推送）。
- **批 2**：守密人添加 workflow + 盯首次归档执行（不可逆）。

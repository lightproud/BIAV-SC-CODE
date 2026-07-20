# Workflow API Key 使用清查

> **⚠ 定格清查（2026-04-20 快照）**：文中部分 workflow（`dream.yml` / `fetch-wiki-data.yml` / `update-news-highfreq.yml` 等）已于 2026-06 退役删除，相关行按历史清查理解；现行 workflow 清单以 `ls .github/workflows/` 为准。
>
> 最后更新：2026-04-20 by 主控台派发子代理（B4）
> 目的：评估 GitHub Secrets 中的凭据是否仍有使用点，为守密人决定"是否清理 GitHub Settings → Secrets"提供依据
> 扫描范围：`.github/workflows/*.yml`（共 13 个文件）
> 扫描方法：Grep `secrets\.`、`API_KEY|TOKEN|api-key|api_key|anthropic_api`，逐文件复核上下文

---

## 一、Secrets 使用矩阵

| Secret 名 | 使用 workflow | 使用点（文件:行号） | 是否仍需 |
|----------|-------------|-------|---------|
| `ANTHROPIC_API_KEY` | `claude.yml`, `dream.yml` | `claude.yml:22`, `dream.yml:253`, `dream.yml:259`, `dream.yml:351` | 仍需 |
| `GITHUB_TOKEN` | `deploy-site.yml` | `deploy-site.yml:100` | 仍需（平台自动注入） |
| `TWITTER_BEARER_TOKEN` | `update-news.yml`, `update-news-highfreq.yml`, `test-collectors.yml` | `update-news.yml:30,39`, `update-news-highfreq.yml:29`, `test-collectors.yml:36,156` | 仍需 |
| `YOUTUBE_API_KEY` | `update-news.yml`, `update-news-highfreq.yml`, `test-collectors.yml` | `update-news.yml:31,40`, `update-news-highfreq.yml:30`, `test-collectors.yml:37,157` | 仍需 |
| `YOUTUBE_CHANNEL_ID` | `update-news.yml`, `update-news-highfreq.yml`, `test-collectors.yml` | `update-news.yml:32`, `update-news-highfreq.yml:31`, `test-collectors.yml:38` | 仍需（公开 ID，按 lessons #9 建议后续硬编码） |
| `DISCORD_BOT_TOKEN` | `update-news.yml`, `update-news-highfreq.yml`, `test-collectors.yml`, `discord-archive.yml`, `discord-history-backfill.yml` | `update-news.yml:33,41`, `update-news-highfreq.yml:32`, `test-collectors.yml:39,158`, `discord-archive.yml:50`, `discord-history-backfill.yml:28` | 仍需 |
| `LLM_API_KEY` | `update-news.yml`, `update-news-highfreq.yml` | `update-news.yml:34`, `update-news-highfreq.yml:33` | 仍需（聚合器分析层） |
| `DISCORD_CHANNEL_IDS` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:42`, `test-collectors.yml:159` | 仍需（公开 ID，但仍注入） |
| `FACEBOOK_ACCESS_TOKEN` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:43`, `test-collectors.yml:160` | 仍需 |
| `FACEBOOK_PAGE_IDS` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:44`, `test-collectors.yml:161` | 仍需（公开 ID） |
| `TWITCH_CLIENT_ID` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:45`, `test-collectors.yml:162` | 仍需 |
| `TWITCH_ACCESS_TOKEN` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:46`, `test-collectors.yml:163` | 仍需 |
| `INSTAGRAM_ACCESS_TOKEN` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:47`, `test-collectors.yml:164` | 仍需 |
| `INSTAGRAM_USER_ID` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:48`, `test-collectors.yml:165` | 仍需（公开 ID） |
| `TELEGRAM_CHANNELS` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:49`, `test-collectors.yml:166` | 仍需（公开 ID） |
| `DC_GALLERY_ID` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:50`, `test-collectors.yml:167` | 仍需（公开 ID） |
| `QQ_CHANNEL` | `update-news.yml`, `test-collectors.yml` | `update-news.yml:51`, `test-collectors.yml:168` | 仍需（公开 ID） |
| `WEIBO_COOKIE` | `update-news.yml` | `update-news.yml:53` | 仍需（登录态 Cookie） |
| `XHS_COOKIE` | `update-news.yml` | `update-news.yml:54` | 仍需 |
| `DOUYIN_COOKIE` | `update-news.yml` | `update-news.yml:55` | 仍需 |
| `ZHIHU_COOKIE` | `update-news.yml` | `update-news.yml:56` | 仍需 |
| `NGA_COOKIE` | `update-news.yml` | `update-news.yml:57` | 仍需 |
| `NAVER_COOKIE` | `update-news.yml` | `update-news.yml:58` | 仍需 |

**说明**：
- `GITHUB_TOKEN` 由 GitHub 平台在每次 workflow 运行时自动注入，无需在 Settings → Secrets 中手工配置；其他 workflow 若使用同一令牌则直接写作 `${{ github.token }}`（见 `discord-archive.yml:56,63`、`extract-game-data.yml:33`）。
- "是否仍需"列的判断仅基于本地 `.github/workflows/` 声明。若某 Secret 已配置但本地无引用，则列入第三节"可清理清单"。

---

## 二、每个 workflow 的 API key 概览

### `.github/workflows/backfill-news.yml`
- 使用的 secrets：无（仅有 `with:` 的 action 参数，非 secrets 引用）
- env/with 参数：无凭据注入
- 推断用途：新闻回填的一次性手工任务，不接外部 API（使用已归档数据）

### `.github/workflows/check-version.yml`
- 使用的 secrets：无
- env/with 参数：无凭据注入（仅 `actions/checkout` 等公共 action）
- 推断用途：每周一游戏版本更新检测，数据来源应为公开爬取

### `.github/workflows/claude.yml`
- 使用的 secrets：`ANTHROPIC_API_KEY`（第 22 行，传给 `anthropics/claude-code-action@v1` 的 `anthropic_api_key` 参数）
- env/with 参数：`direct_push: "true"`
- 推断用途：Issue 触发 Claude Code 自动响应；API key 为核心凭据，不可移除

### `.github/workflows/deploy-site.yml`
- 使用的 secrets：`GITHUB_TOKEN`（第 100 行，传给 `peaceiris/actions-gh-pages@v4`）
- env/with 参数：`publish_dir: ./dist` / `publish_branch: gh-pages` / `force_orphan: true`
- 推断用途：push 触发主站 + Wiki + News 部署；B1a 已确认无 `ANTHROPIC_API_KEY` 引用
- **验证结论**：本次扫描确认 `deploy-site.yml` 不再引用 `ANTHROPIC_API_KEY`

### `.github/workflows/discord-archive.yml`
- 使用的 secrets：`DISCORD_BOT_TOKEN`（第 50 行）
- env/with 参数：`GH_TOKEN: ${{ github.token }}`（第 56、63 行，用于上传 Release 资产）
- 推断用途：每日 18:00 UTC Discord 归档 + 每月 1 日清理

### `.github/workflows/discord-history-backfill.yml`
- 使用的 secrets：`DISCORD_BOT_TOKEN`（第 28 行）
- env/with 参数：无额外
- 推断用途：Discord 历史回填一次性任务

### `.github/workflows/dream.yml`
- 使用的 secrets：`ANTHROPIC_API_KEY`（第 253、259、351 行）
  - 第 253 行：deep-sleep 层 `env:` 注入，供 `scripts/dream.py --full --report` 调用 Anthropic SDK
  - 第 259 行：deep-sleep 层 `anthropics/claude-code-action@v1`，执行深睡整理
  - 第 351 行：rem-sleep 层 `anthropics/claude-code-action@v1`，执行每周深度反思
- env/with 参数：`direct_push: "true"` + 长 prompt（深睡/REM 任务描述）
- 推断用途：三层做梦架构（浅睡无 API key，深睡 + REM 依赖 ANTHROPIC_API_KEY）；核心凭据

### `.github/workflows/extract-game-data.yml`
- 使用的 secrets：无（仅使用 `${{ github.token }}`，第 33 行）
- env/with 参数：`GH_TOKEN`
- 推断用途：游戏数据抽取任务，与 Release 交互用平台注入令牌

### `.github/workflows/fetch-wiki-data.yml`
- 使用的 secrets：无
- env/with 参数：仅 action 的 `with:`（非 secrets）
- 推断用途：每周一抓取 Fandom / Bilibili Wiki 公开数据

### `.github/workflows/test-collectors.yml`
- 使用的 secrets：14 个（与 `update-news.yml` 重合）
  - `TWITTER_BEARER_TOKEN`（36, 156）
  - `YOUTUBE_API_KEY`（37, 157）
  - `YOUTUBE_CHANNEL_ID`（38）
  - `DISCORD_BOT_TOKEN`（39, 158）
  - `DISCORD_CHANNEL_IDS`（159）
  - `FACEBOOK_ACCESS_TOKEN`（160）
  - `FACEBOOK_PAGE_IDS`（161）
  - `TWITCH_CLIENT_ID`（162）
  - `TWITCH_ACCESS_TOKEN`（163）
  - `INSTAGRAM_ACCESS_TOKEN`（164）
  - `INSTAGRAM_USER_ID`（165）
  - `TELEGRAM_CHANNELS`（166）
  - `DC_GALLERY_ID`（167）
  - `QQ_CHANNEL`（168）
- 推断用途：采集器测试 workflow，凭据与生产聚合器共用

### `.github/workflows/update-news-highfreq.yml`
- 使用的 secrets：`TWITTER_BEARER_TOKEN`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `DISCORD_BOT_TOKEN`, `LLM_API_KEY`（29-33 行）
- env/with 参数：仅 env 注入
- 推断用途：高频采集（小时级），仅覆盖 4 个高频源 + LLM 分析

### `.github/workflows/update-news.yml`
- 使用的 secrets：22 个（日常多平台聚合的完整凭据集）
- env/with 参数：env 注入 23 项（含 `GITHUB_REPOSITORY` 等非 secrets）
- 推断用途：每日 06:00 / 16:00 UTC 多平台社区新闻聚合，最主要的凭据消耗点

### `.github/workflows/validate-data.yml`
- 使用的 secrets：无
- env/with 参数：仅 action 的 `with:`
- 推断用途：push 触发事实圣经 JSON Schema 校验，无需外部 API

---

## 三、可清理清单

**扫描结果：零条可立即清理的 Secret。**

本次扫描覆盖 `.github/workflows/` 下所有 13 个 YAML 文件，所列 22 项非平台注入型 secrets（即排除 `GITHUB_TOKEN`）均至少被一个 workflow 引用。若守密人在 GitHub Settings → Secrets 面板中发现仓库实际配置的 secret 名称超出本表，则差集即为可清理候选——本仓库代码侧无法直接枚举远端实际配置，建议守密人以本文件第一节"Secrets 使用矩阵"为白名单对照删减。

**间接优化建议**（不属"清理 secret"，但属后续治理）：
1. `YOUTUBE_CHANNEL_ID` / `DISCORD_CHANNEL_IDS` / `FACEBOOK_PAGE_IDS` / `INSTAGRAM_USER_ID` / `TELEGRAM_CHANNELS` / `DC_GALLERY_ID` / `QQ_CHANNEL` 都是公开 ID，按 `memory/lessons-learned.md` 第 9 条建议，未来可以直接硬编码到 workflow 文件，减少 secrets 面板噪音。但这属于代码改动，不在本次"仅清查"范围。
2. `test-collectors.yml` 与 `update-news.yml` 凭据完全重合，属正常共用（同源同 token），不可因"重复"删除任一方。

---

## 四、注意事项

1. **本地 vs 远端差集无法检测**：本次扫描只看本地 workflow 声明，实际 GitHub 仓库的 Secrets 面板可能包含：
   - 旧 workflow 删除后遗留的孤儿 secret（例：若历史上 `deploy-site.yml` 曾有 `ANTHROPIC_API_KEY`，清理代码后远端 secret 不会自动删）
   - 为未来功能预留但未投入使用的 secret
   建议守密人登录 GitHub Settings → Secrets and variables → Actions，把清单对照本文件第一节的白名单手工核对。

2. **`deploy-site.yml` 确认干净**：B1a 的发现已复核——当前版本（2026-04-20，4375 字节）仅使用 `GITHUB_TOKEN`，不再注入 `ANTHROPIC_API_KEY`。如果 GitHub Settings 中 `ANTHROPIC_API_KEY` 原本只服务于 `deploy-site.yml`，那仍不能删——`claude.yml` 和 `dream.yml` 共 4 处引用它。

3. **`LLM_API_KEY` 与 `ANTHROPIC_API_KEY` 为两个独立 secret**：前者在 `update-news.yml`/`update-news-highfreq.yml` 中供聚合器分析层使用（大概率是其他 LLM 供应商或次级 Anthropic key），后者专供 `claude.yml`/`dream.yml` 的 Claude Code Action。守密人若轮转密钥需分开处理。

4. **浅睡层无 API key**：`dream.yml` 的浅睡层（shallow-sleep job）为纯 shell 结构检查，零 token 成本，未注入任何 secret；只有深睡（deep-sleep）+ REM（rem-sleep）需要 `ANTHROPIC_API_KEY`。

5. **公开 ID 型 secret 的保留判断**：本表将 `YOUTUBE_CHANNEL_ID` 等公开 ID 全部列为"仍需"，因为当前 workflow 仍通过 `${{ secrets.XXX }}` 读取它们——删除 secret 会导致运行时为空。若要清理需先改 workflow 硬编码（属代码任务，不属 secret 管理任务）。

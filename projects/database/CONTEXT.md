# Database 官方数据库 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## 当前状态：数据就绪，校验中

## 目标
系统性整理忘却前夜的官方游戏数据，为衍生游戏和社区分析提供数据基础。

## 存储格式
已确定：模块化 JSON（`projects/database/data/db/`）

## 数据来源
- GameKee wiki
- Fandom Sialia wiki
- Gamerch JP wiki

## 数据文件清单

| 文件 | 内容 |
|------|------|
| `characters.json` | 唤醒体（角色）数据：56 个 SSR/SR，含属性、界域、稀有度、获取方式 |
| `skills.json` | 技能与卡牌系统 |
| `combat.json` | 战斗机制、状态效果 |
| `equipment.json` | 命轮与圣契装备 |
| `realms.json` | 四大界域体系（Chaos、Aequor、Caro、Ultra） |
| `gacha.json` | 抽卡系统与 banner 历史 |
| `progression.json` | 养成与进阶系统 |
| `lore.json` | 世界观设定、组织、关键角色、主线剧情 |
| `maps.json` | 地图与关卡数据 |
| `items.json` | 道具数据 |
| `teams.json` | 编队与阵容推荐 |
| `versions.json` | 版本线与联动记录 |
| `terminology.json` | 游戏专有术语 |
| `art_assets.json` | 美术资源引用（Steam CDN 等） |
| `meta.json` | 元数据与 tier 信息 |
| `key_commands.json` | 指令钥匙系统 |
| `content_database.json` | 旧版单文件数据库（已被模块化文件取代） |

## 查询模块
- `scripts/content_db.py`：Python 查询接口，支持角色查询、界域查询、术语搜索等
- 路径使用 `os.path.dirname(__file__)` 相对引用，无需配置

## 下一步
- [ ] 数据准确性校验（与 wiki 源对比）
- [ ] 接入 Fandom/Gamerch wiki 自动更新
- [ ] 补充缺失数据（消耗品、活动等）

## 给 Code 会话的指令
- 工作目录：`projects/database/`
- 数据文件在：`projects/database/data/db/`
- 中间产出放：`projects/database/output/`
- 新数据文件添加后更新本文件和 `assets/index.md`
- 角色/系统信息同步更新 `memory/morimens-context.md`

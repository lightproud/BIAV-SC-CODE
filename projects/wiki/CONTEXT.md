# Wiki 子项目上下文

## 负责会话
Code-wiki

## 目标
构建忘却前夜的游戏数据集与多语言 Wiki 站点，为社区和衍生游戏提供数据基础。

## 项目包含两部分

### 1. 游戏数据集（原 database 子项目）
- **数据文件**：`data/db/` 下 16 个模块化 JSON（角色、技能、装备、战斗、世界观等）
- **查询模块**：`scripts/content_db.py`，Python 接口
- **数据来源**：GameKee wiki、Fandom Sialia、Gamerch JP
- **存储格式**：JSON

### 2. Wiki 站点
- **框架**：VitePress 1.6.3 + Vue 3.5.13
- **语言**：英语、日语、中文
- **页面**：EN/JA 各 64 页，ZH 62 页（部分为模板待填充）

## 目录说明
- `data/` — 游戏数据集（JSON）
- `scripts/` — 数据查询模块（Python）
- `docs/` — VitePress 源文件（Markdown 页面）
- `docs/.vitepress/` — VitePress 配置和主题
- `exports/` — 导出的文档副本（docx/md）

## 开发命令
```bash
# Wiki 站点
cd projects/wiki
npm install
npm run docs:dev    # 本地开发
npm run docs:build  # 构建
npm run docs:preview # 预览构建结果

# 数据查询
python scripts/content_db.py
```

## 下一步
- [ ] 数据准确性校验（与 wiki 源对比）
- [ ] 接入 Fandom/Gamerch wiki 自动更新
- [ ] 补充缺失数据（消耗品、活动等）
- [ ] 填充 Wiki 模板页面
- [ ] 部署到 GitHub Pages

## 给 Code 会话的指令
- 工作目录：`projects/wiki/`
- 数据文件在：`projects/wiki/data/db/`
- 新数据文件添加后更新本文件和 `assets/index.md`
- 角色/系统信息同步更新 `memory/morimens-context.md`

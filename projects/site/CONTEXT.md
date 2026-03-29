# Code-site 上下文

## 职责
- 主站导航页（`site/`）设计与开发
- 统一部署流水线（`.github/workflows/deploy-site.yml`）维护
- 跨子站视觉一致性（执行 `memory/style-guide.md`）
- 页面交互体验、响应式适配
- 共享前端资源（公共 CSS/JS/字体）

## 不负责
- Wiki 页面内容 → Code-wiki
- News 页面内容 → Code-news
- 数据采集和处理脚本 → 各子项目

## 关键文件
| 文件 | 说明 |
|------|------|
| `site/index.html` | 主站导航页 |
| `.github/workflows/deploy-site.yml` | 统一部署流水线 |
| `memory/style-guide.md` | 视觉规范 |

## 部署架构
```
dist/                          # 最终部署产物
├── index.html                 # 主站导航页（来自 site/）
├── wiki/                      # VitePress 构建产物（来自 projects/wiki/）
└── news/                      # News 静态页面（来自 projects/news/）
```

- 根路径 `/` → 主站导航页
- `/wiki/` → VitePress Wiki 站点
- `/news/` → 社区情报页面
- 部署目标：GitHub Pages（通过 `peaceiris/actions-gh-pages@v4` 推送 gh-pages 分支）
- Pages Source 设置：Deploy from a branch → gh-pages / root

## 与其他子项目的协作约定
- Wiki/News 子项目修改各自页面内容，但不修改部署流水线
- 视觉规范变更由 Code-site 统一推送，其他子项目遵循
- 新增子站点（如 game）时，由 Code-site 扩展部署流水线

## 验证清单
- [ ] `site/index.html` 在浏览器中正常显示
- [ ] `deploy-site.yml` 语法正确（`actionlint` 或手动检查）
- [ ] 构建产物 `dist/` 包含 index.html、wiki/、news/ 三个部分
- [ ] 导航链接指向正确的子路径

## 当前任务（2026-03-29）

> 对应 Issue #58。这是 Code-site 的第一批任务。

### 1. ~~验证部署流水线可用性~~（已完成 2026-03-29）
- ✅ VitePress base 路径 `/brain-in-a-vat/wiki/` 与部署架构一致
- ✅ `package.json` / `package-lock.json` 存在，`npm ci` + `npm run build` 通过
- ✅ `projects/news/index.html` 存在
- ✅ 修复了 YAML frontmatter 冒号转义、portrait 路径 import 错误、npm script 名错误
- ✅ 添加了 wiki 根目录 `index.md`（按浏览器语言自动跳转）
- ✅ 添加了构建产物验证步骤
- ✅ 部署方式从 `deploy-pages@v4` 改为 `peaceiris/actions-gh-pages@v4`（推送 gh-pages 分支）

### 2. 优化主站导航页
- 审查 `site/index.html` 当前代码质量和视觉效果
- 确保完全遵循 `memory/style-guide.md` 视觉规范
- 优化响应式布局（移动端适配）
- 确保三张卡片链接正确：Wiki → `./wiki/`、News → `./news/`、Game → `#about`
- 添加 favicon 和 Open Graph meta（如果缺少）
- 提升交互体验（适度，不要过度设计）

### 3. 确保跨站视觉一致性
- 对比 wiki 站点（VitePress）和主站的视觉风格是否协调
- 如果有明显不一致，记录下来（wiki 的样式由 Code-wiki 修改，你只负责发现和建议）

### 4. 评估 site/ 目录位置
- 当前主站文件在仓库根目录 `site/`，而不在 `projects/site/`
- 评估是否应该迁移到 `projects/site/` 下统一管理
- 如果迁移，同步更新 `deploy-site.yml` 中的路径引用

### 约束
- 不要修改 `projects/wiki/` 或 `projects/news/` 下的内容文件
- 不要修改 `CLAUDE.md` 或 `memory/` 文件（那是主控台的职责）
- 部署架构（根路径=主站，/wiki/=VitePress，/news/=情报页）已确定，不要改变
- 流水线的实现细节（构建步骤、缓存策略等）可以自由优化

## 部署排障手册

> 404 的根因几乎总是以下几点之一。修改前先逐项检查。

### 前置条件
- GitHub Pages Source 必须设为 **Deploy from a branch → gh-pages / root**（不是 GitHub Actions）
- 仓库名 `brain-in-a-vat` 决定了所有路径的前缀是 `/brain-in-a-vat/`

### 路径对齐关系（这是最容易出错的地方）

```
最终 URL                                     对应 dist/ 下的文件          来源
─────────────────────────────────────────    ──────────────────────      ──────────────
lightproud.github.io/brain-in-a-vat/         dist/index.html             site/index.html
lightproud.github.io/brain-in-a-vat/wiki/    dist/wiki/index.html        VitePress 构建产物
lightproud.github.io/brain-in-a-vat/news/    dist/news/index.html        projects/news/index.html
```

### VitePress base 路径
- `config.mts` 中 `base: '/brain-in-a-vat/wiki/'`
- 这意味着 VitePress 构建产物内的所有资源引用（CSS/JS/图片）都带 `/brain-in-a-vat/wiki/` 前缀
- 构建产物必须放在 `dist/wiki/` 下，这样 URL 路径才能对齐
- **绝对不要**把 VitePress 产物放在 `dist/` 根目录——会导致所有静态资源 404

### VitePress 首页
- `rewrites: { 'zh/:rest*': ':rest*' }` 把 `docs/zh/index.md` 映射到 `/`
- VitePress 根路径必须有内容，否则 `/wiki/` 返回 404
- 验证：构建后 `dist/wiki/index.html` 必须存在且有内容

### deploy-site.yml 核心步骤
```yaml
# 1. 构建 wiki
working-directory: projects/wiki
run: npm run build    # 不是 docs:build，检查 package.json scripts

# 2. 组装 dist/
mkdir -p dist/wiki dist/news
cp site/index.html dist/                                    # 主站
cp -r projects/wiki/docs/.vitepress/dist/* dist/wiki/       # wiki 构建产物
cp projects/news/index.html dist/news/index.html            # news
touch dist/.nojekyll                                        # 防止 Jekyll 处理

# 3. 验证（必须在部署前检查）
test -f dist/index.html       || exit 1
test -f dist/wiki/index.html  || exit 1
test -f dist/news/index.html  || exit 1
```

### 常见 404 原因速查

| 症状 | 原因 | 修复 |
|------|------|------|
| 全站 404 | Pages Source 设置错误 | Settings → Pages → branch: gh-pages / root |
| 主站 OK，wiki 404 | VitePress 构建失败或产物路径错 | 检查 `npm run build` 输出、`dist/wiki/` 是否有文件 |
| wiki 首页 404，子页面 OK | 缺少根 index.md 或 rewrites 失效 | 确认 `docs/zh/index.md` 存在且 rewrites 配置正确 |
| wiki 页面白屏（HTML OK 但无样式） | base 路径不匹配 | 确认 `config.mts` base 是 `/brain-in-a-vat/wiki/` |
| news 404 | `projects/news/index.html` 不存在 | 检查文件是否存在 |
| CSS/JS 资源 404 | VitePress 产物放错位置 | 必须放在 `dist/wiki/` 下 |

## 给 Code 会话的指令
1. 阅读 `/CLAUDE.md` 了解项目全局
2. 阅读 `memory/style-guide.md` 了解视觉规范
3. 查看 `site/index.html` 当前状态
4. 查看 `.github/workflows/deploy-site.yml` 部署流水线
5. 执行上方「当前任务」
6. 不要修改 `projects/wiki/` 或 `projects/news/` 下的内容文件
7. 完成后在 Issue #58 下 comment 结果

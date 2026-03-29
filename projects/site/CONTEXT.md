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
- 部署目标：GitHub Pages（通过 `deploy-pages@v4`）

## 与其他子项目的协作约定
- Wiki/News 子项目修改各自页面内容，但不修改部署流水线
- 视觉规范变更由 Code-site 统一推送，其他子项目遵循
- 新增子站点（如 game）时，由 Code-site 扩展部署流水线

## 验证清单
- [ ] `site/index.html` 在浏览器中正常显示
- [ ] `deploy-site.yml` 语法正确（`actionlint` 或手动检查）
- [ ] 构建产物 `dist/` 包含 index.html、wiki/、news/ 三个部分
- [ ] 导航链接指向正确的子路径

## 给 Code 会话的指令
1. 阅读 `/CLAUDE.md` 了解项目全局
2. 阅读 `memory/style-guide.md` 了解视觉规范
3. 查看 `site/index.html` 当前状态
4. 查看 `.github/workflows/deploy-site.yml` 部署流水线
5. 不要修改 `projects/wiki/` 或 `projects/news/` 下的内容文件

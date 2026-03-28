# Wiki 子项目上下文

## 负责会话
Code-wiki

## 目标
基于 VitePress 构建忘却前夜多语言 Wiki 站点（EN/JA/ZH）。

## 技术栈
- VitePress 1.6.3 + Vue 3.5.13
- 多语言：英语、日语、中文

## 目录说明
- `docs/` — VitePress 源文件（Markdown 页面）
- `docs/.vitepress/` — VitePress 配置和主题
- `exports/` — 导出的文档副本（docx/md）

## 开发命令
```bash
cd projects/wiki
npm install
npm run docs:dev    # 本地开发
npm run docs:build  # 构建
npm run docs:preview # 预览构建结果
```

## 依赖
- 无外部数据依赖
- 内容来源：游戏公开信息、社区整理

## 当前状态
- EN/JA 内容较完整（各 64 页）
- ZH 内容稍少（62 页）
- 部分页面为模板待填充

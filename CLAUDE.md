# BIAV-SC — 忘却前夜 AI 增强插件

> 本文件为 Claude Code 自动加载入口。完整内容请读取 `BIAV-SC.md`。

请立即读取本仓库根目录的 **BIAV-SC.md**，那是平台无关的完整插件定义。

## 沟通规则

- **始终使用中文**进行所有过程说明、状态报告和对话。代码注释和 commit message 可用英文。

## BIAV Web Terminal 版本管理（严格执行）

每次修改 `projects/biav/index.html` 并提交时，**必须**同步更新版本号：

1. **`APP_VERSION` 常量**（`const APP_VERSION = 'x.y.z'`）— 递增 patch（修复）或 minor（新功能）
2. **侧边栏 HTML**（`<div id="sidebar-footer">vx.y.z</div>`）— 与 APP_VERSION 一致
3. **`projects/biav/CHANGELOG.md`**— 在顶部添加新版本条目，格式参考已有条目

版本号规则：
- 修复/优化/微调 → patch +1（如 0.12.0 → 0.12.1）
- 新功能/新工具 → minor +1（如 0.12.1 → 0.13.0）
- 重大架构变更 → major +1

**绝对不允许**提交 `index.html` 的功能改动但不更新版本号。如果一次会话中有多次提交，可以只在最终提交时升版，但推送前必须确认版本已更新。

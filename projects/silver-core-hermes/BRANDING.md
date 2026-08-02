# BRANDING.md — 品牌换装范围台账（需求 #1，守密人 2026-08-02 两项交互裁定）

裁定：① 零侵入套件 + 开 `patches/` 全量抹净并行；② 产品面知识层统一称
**「知识底座」（Knowledge Base）**，Black Pool / 黑池字样不出现于任何用户可见文案。

## 已覆盖面（pin v2026.7.30 实测）

| 面 | 手段 | 量 |
|----|------|----|
| 对话人格自称 | `deploy/SOUL.md.template`（身份槽 #1，原生机制零侵入） | 1 档 |
| 兜底身份句（SOUL.md 缺席时） | 补丁：`You are Hermes Agent, … created by Nous Research.` → `You are Silver Core, …` | 1 处 |
| 运行面显示串 `Hermes Agent` → `Silver Core` | 规则补丁（agent / hermes_cli / gateway / tools / plugins / ui-tui/src） | 159 文件 / 2,946 行 diff |
| `Hermes profile` → `Silver Core profile` | 同上 | 30 处 |
| `hermes-tui` 诊断前缀 → `silver-core-tui` | 同上 | 10 处 |
| CLI 命令名 | `deploy/bin/silver-core` 别名包裹（零侵入） | 1 件 |
| 钉钉显示名 | 钉钉应用后台配置（内网侧） | 部署说明 |

## 刻意不碰（红线，守卫 `tests/test_hermes_charter.py`）

- **LICENSE / 版权行 / SPDX**：MIT 硬要求 + 文书裁 10（禁「100% 纯自研」口径）。
- **URL**（github.com/NousResearch/… 等）：来源事实，不伪装。
- **`HERMES_*` 环境变量名 / 配置键 / `~/.hermes` 路径 / 模块与包名**：功能标识符，
  改之即 fork 级侵入且破坏上游测试基线。
- **`X-Client-Name: hermes-agent` 遥测头**：对上游服务如实自报，不冒充。
- **上游测试与文档**（tests/ · *.md）：测试基线须与官方逐字节同判；文档非部署运行面。

## 已知残留（照实记录，随移 pin 复测）

- 非白名单目录（website / apps / docs / web 等非部署面）的品牌串未扫——不进部署产物。
- 含 URL / `HERMES_*` 的行内伴生显示词因跳线谓词整行保留（保护优先于净度）。
- 安装器 `install.sh` / `hermes update` 路径的品牌串未处理——生产禁用该路径（文书 §2.4）。

维护：补丁由 `deploy/rebrand.py` 规则引擎确定性生成，移 pin 重生成、`--check` 防漂移；
残留升格诉求出现时改规则不改补丁。

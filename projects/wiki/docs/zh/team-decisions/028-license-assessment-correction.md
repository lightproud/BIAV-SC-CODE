---
title: "**许可证评估修正**（2026-04-14 当日修正上一条的\"无 LICENSE\"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = \"MIT\"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节"
category: "全局"
date: "2026-04-14"
---

# **许可证评估修正**（2026-04-14 当日修正上一条的"无 LICENSE"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = "MIT"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节

**影响范围**：全局 / bpt-next

## 决策内容

**许可证评估修正**（2026-04-14 当日修正上一条的"无 LICENSE"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = "MIT"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节。Rust 生态共识：Cargo.toml SPDX license 字段是法律认可的授权声明（crates.io / cargo-about / cargo-deny 均依赖此字段）。**主运行时 claw CLI = 明确 MIT 授权**。src/（Python 镜像）上游已声明"非主运行时"，无独立 LICENSE 但不影响 claw 主使用。风险等级从"致命"下调为"低"。建议上游加 LICENSE 文件仍作为友好建议。NOTICE 与 CONTEXT 已同步修正

---

*本文件由 Code-主控台 subagent 从 `memory/decisions.md` 自动拆分，未经艾瑞卡定稿。*

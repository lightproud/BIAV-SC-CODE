<!--
内部（守密人 / AI 会话）PR 模板。社区贡献已取消（守密人 2026-07-10 裁定，
对社区单向可读）——本仓库不受理外部 PR，外部提交将被直接关闭。
原贡献协议历史档案见 memory/contribution-protocol.md（已退役）。
-->

## 概述

简述本 PR 的目的与变更范围（一两句话即可）。

---

## 变更类型

- [ ] 数据补全（Wiki characters / wheels / items / banners / stages / lore）
- [ ] 翻译贡献（zh / en / ja）
- [ ] 文档完善（CLAUDE.md / BIAV-SC.md / README.md / 子项目 CONTEXT.md）
- [ ] Bug 修复
- [ ] 视觉/前端改进（site / wiki theme / news 模板）
- [ ] 其他（请说明）：

---

## 来源声明

> 所有数据必须可追溯至**公开来源**。

- [ ] 本 PR 涉及的数据可在以下公开来源查到（请列出 URL 或截图来源）：

  ```
  例：https://morimens.fandom.com/wiki/Daffodil
      游戏内 v2.4.0 主线 Ch7 截图
  ```

- [ ] 翻译类 PR：标注 `translation_source: "official"` 或 `"community"`，社区翻译附依据

---

## 安全声明（强制）

- [ ] **本贡献不包含来自 BIAV 内网 / 黑池 / 未发布渠道的任何数据。** 所有引用素材均来自公开可查阅来源。

- [ ] **本贡献的游戏图片 / 数据 / 文本仅引用公开素材**；不上传内部美术资产、客户端解包原始文件、未公开的剧情草稿等。

- [ ] **同意按 [MIT License](../LICENSE) 提交贡献。** 游戏相关版权归脑缸组（B.I.A.V. Studio）及合作方所有，本仓库引用仅限公开可查阅信息。

---

## 验证清单

- [ ] 本地跑通对应校验脚本（如 `python projects/wiki/scripts/validate_data.py` / `python assets/data/validate.py`）
- [ ] 若涉及 site / wiki / news 视觉，已在本地预览（`npm run dev` 或浏览器打开 HTML）
- [ ] 不引入 emoji（按 `CLAUDE.md` 硬约束）
- [ ] 不动 `memory/decisions.md` / `memory/lessons-learned.md` 等档案（这些归主控台）

---

## 关联 Issue

- Closes #
- Refs #

<!--
审核流程提示（不需贡献者填写）：
- CI 自动校验：validate-data.yml + deploy-site.yml smoke test
- 人工审核：守密人为唯一最终批准方（contribution-protocol.md § 4.2）
- 合并方式：默认 squash-and-merge
-->

# deploy/ — 通用部署与品牌组装（零内网值）

> 施工边界：本目录只放**参数化通用件**；端点、凭据、内网路径一律在内网侧部署配置
> （文书裁 5 切面化）。生产禁用 `hermes update`（文书 §2.4），更新只有「换 tag 重测」。

## 品牌换装组装流程（需求 #1，守密人 2026-08-02）

1. 取纯净源：从生产供应链 vendor 仓（或本仓 `upstream/` 开发镜像）拷出组装副本 `DEST/`。
2. 应用品牌补丁（二选一，效果相同）：
   - `git apply --directory=DEST patches/silver-core-rebrand.patch`（可审计补丁）
   - `python3 deploy/rebrand.py --apply DEST`（规则引擎直施）
3. TUI 为 TypeScript 源码：补丁改的是 `ui-tui/src/`，组装后须按上游流程重建 TUI 产物。
4. 身份：`deploy/SOUL.md.template` 拷入 HERMES_HOME 为 `SOUL.md`（身份槽 #1，
   产品自称 Silver Core、知识层统一称「知识底座」）。
5. 命令名：`deploy/bin/silver-core` 拷入 PATH（`SILVER_CORE_HERMES_BIN` 可指定入口）。
6. 钉钉显示名：在钉钉应用后台把机器人显示名设为 Silver Core（配置属内网侧，不入本仓）。

## 补丁维护（移 pin 例程的一部分）

- 补丁**不手写**：规则与排除谓词在 `deploy/rebrand.py`，`patches/silver-core-rebrand.patch`
  是其确定性输出。移 pin 后重跑 `python3 deploy/rebrand.py` 重生成；
  `--check` 为漂移守卫（补丁与规则输出不一致即红）。
- 红线：LICENSE / 版权行 / URL / `HERMES_*` 环境变量 / `X-Client-Name` 遥测头不碰
  （守卫 `tests/test_hermes_charter.py`）。
- 残留清单与范围理由见 `../BRANDING.md`。

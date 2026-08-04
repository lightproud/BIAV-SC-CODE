# hermes-agent v2026.8.3（引擎 0.20.0）快照全量测试实证（移 pin 复跑）

- 日期：2026-08-04（北京时间）· 执行：艾瑞卡会话（分支 `claude/hermes-0-20-update-powcs4`）
- 对象：`projects/black-pool-agent/upstream/` 快照（pin `v2026.8.3` / commit `3c27eb62` / 引擎 0.20.0）
- 环境：银芯云容器（Linux，root 用户，4 核，无 IPv6、无 openssh-client、无 systemd）
- 前跑基线：`hermes-upstream-testrun-20260802.md`（v2026.7.30 / 0.19.1 首跑，40 例假红四簇分诊）

## 一句话结论

0.20.0 套件在银芯容器内**可完整复现运行**：**2,599 测试文件 / 25,176 断言通过 / 35 失败
+ 1 收集期错误**；36 个受影响档逐簇分诊**全部为环境 / 布局伪影，零上游代码真缺陷**。
对首跑：假红池 40 → 36 净缩（上游修复自更新家族 5 例的 git 检出假设），两张新面孔均查实为
已知簇的新成员（详见分诊表），无新增缺陷类别。

## 复现口径（与首跑一致处从简，差异处加粗）

| 项 | 值 |
|----|----|
| uv | 0.9.28（上游 tests.yml 钉版，0.20 核对未变）。**获取方式变更：astral.sh 官方安装脚本被银芯出网代理 403，改 GitHub Releases 直下二进制**（`uv-x86_64-unknown-linux-gnu.tar.gz`）|
| 依赖 | `uv sync --locked --python 3.11 --extra all --extra dev --extra anthropic --extra mistral --extra fal --extra modal --extra daytona --extra hindsight --extra parallel-web`（九 extra 口径核对无增减）|
| Python | 3.11.15 |
| 运行器 | `scripts/run_tests.sh -j 4`。**0.20 需显式设 `HERMES_PYTHON=<venv>/bin/python`**——运行器只认树内 `.venv` 或该环境变量，venv 按纪律落会话 scratchpad 时必设（首跑报告未记此参数，本轮实测缺它直接拒跑）|
| API key | `OPENROUTER_API_KEY="" OPENAI_API_KEY=""`（防真调用）|
| venv / 缓存 | 全落会话 scratchpad（`UV_PROJECT_ENVIRONMENT` / `UV_CACHE_DIR`），仓树零污染 |

## 36 档分诊（四簇不变，成员有进有出，均非代码缺陷）

| 簇 | 本轮 | 首跑 | 变化与真因 |
|----|-----|------|-----------|
| 自更新家族（布局假红） | **17** | 22 | `test_cmd_update` 12 / `update_yes_flag` 2 / gateway `update_command` 2 / `update_streaming` 1。报错仍为快照 vendor 布局无自身 `.git`。**净缩 5 例**：`test_update_eol_churn` 0.20 已修其 git 检出假设，本轮 9 过全绿 |
| root 用户伪影 | **8** | 9 | 成员同首跑（`approvals_suggest` / `gateway_service` / `migrate_xai` / `xai_provider_labels` / `approval` / `execution_flag_detection`×2 / `lazy_deps_durable_target`）；`gateway_service` 2→1 |
| 环境缺件 | **10** | 8 | ssh×5 / IPv6 双栈×2（`browser_connect_dual_stack` + `webhook_adapter::TestDualStackBind`）/ sqlite 报错文案×1（`state_db_malformed_repair`）不变。**新成员：`test_teams.py` 整档收集期错误**——0.20 上游 #62935 将 Teams SDK 改为延迟导入，测试档收集期真调 `check_teams_requirements()` 触发 lazy install，容器内安装失败（耗时 14.7s 后返回 False）即整档 error；手动 `uv pip install microsoft-teams-apps==2.0.13.4 aiohttp==3.14.1` 后该档 **22/22 全绿，零代码缺陷**。注意 `teams` extra 不含于 `all`、也不在九 extra 口径内 |
| 运行器环境敏感 | **2** | 1 | `test_vision_routing_31179`（首跑已知）；**新成员：`test_tui_gateway_server::test_write_json_serializes_concurrent_writes`**——并发写断言 8 行得 9 行，`-j 4` 负载下偶发时序敏感，同用例独立复跑 3/3 全绿 |

## 附带事实

- 通过断言 25,176 对首跑 22,766（**+2,410**）；测试文件 2,599 对 2,471（+128）——0.20 单版净增
  逾百测试档，上游迭代速率与 M0 深读时观察一致。
- 两张「新面孔」均系上游**测试写法变化**暴露既有环境限制（teams：mock 置位改真装依赖；tui：新增
  并发时序断言），非环境退化亦非代码缺陷。
- 树内跑测后清生成物纪律照例执行（`__pycache__` 清净后方入库，UPSTREAM.md 例程步 2）。

## 对黑池侧输入

1. 0.20.0 移 pin 后基线健康度与 0.19.1 持平（零真缺陷），黑池侧换包重测可引用本轮排除集。
2. 若黑池部署启用 Teams 平台：装配时显式加 `teams` extra 或预装 `microsoft-teams-apps==2.0.13.4`
   ——0.20 起该平台依赖不再被测试 mock 遮蔽，生产同样走 lazy install，内网无公网 PyPI 时必须预装。
3. 复跑本套件的两个新增操作要点已固化在上方口径表（uv 经 GitHub Releases 取 / `HERMES_PYTHON` 必设）。

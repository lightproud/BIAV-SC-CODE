# hermes-agent v2026.7.30 快照全量测试实证（银芯云容器首跑）

- 日期：2026-08-02（北京时间）· 执行：艾瑞卡会话（分支 `claude/bpt-hermes-adaptation-xc3pzl`）
- 对象：`projects/silver-core-hermes/upstream/` 快照（pin `v2026.7.30` / commit `cc4cab2f`）
- 环境：银芯云容器（Linux，root 用户，4 核 / 15G 内存，无 IPv6、无 openssh-client、无 systemd）

## 一句话结论

上游套件在银芯容器内**可完整复现运行**：全量 **2,471 测试文件 / 22,766 通过 / 40 失败**，
954.6 秒（4 worker）；40 例失败经逐簇分诊**全部为环境 / 布局伪影，零上游代码真缺陷**。

## 复现口径（与上游 CI 对齐）

| 项 | 值 |
|----|----|
| uv | **0.9.28**（上游 tests.yml 钉版；容器自带 0.8.17 读不懂其 uv.lock 新语法，此为首个障碍）|
| 依赖 | `uv sync --locked --python 3.11 --extra all --extra dev --extra anthropic --extra mistral --extra fal --extra modal --extra daytona --extra hindsight --extra parallel-web` |
| Python | 3.11.15（上游要求 `>=3.11,<3.14`）|
| 运行器 | `scripts/run_tests.sh -j 4`（上游逐文件隔离运行器；默认 `-m 'not integration'`）|
| API key | `OPENROUTER_API_KEY="" OPENAI_API_KEY=""`（CI 同口径防真调用；容器本身无任何 LLM 供应商 key）|
| venv / 缓存 | 全落会话 scratchpad（`UV_PROJECT_ENVIRONMENT` / `UV_CACHE_DIR`），仓树零污染 |

## 40 例失败分诊（四簇，均非代码缺陷）

| 簇 | 例数 | 真因 | 定性 |
|----|-----|------|------|
| 自更新家族（`test_cmd_update` 12 / `update_eol_churn` 5 / `update_yes_flag` 2 / gateway `update_command` 2 / `update_streaming` 1）| 22 | 报错 `Not a git repository`：自更新命令要求安装根为 git 检出，快照 vendor 布局下 `upstream/` 无自身 `.git` | **布局性结构假红**——在银芯 vendor 布局下永远红，与代码质量无关；未来巡检应列排除集 |
| root 用户伪影（`approvals_suggest` / `gateway_service`×2 / `migrate_xai` / `xai_provider_labels` / `approval` / `execution_flag_detection`×2 / `lazy_deps_durable_target`）| 9 | root 下 PermissionError 不触发、`~` 折叠语义变化、无 systemd/loginctl、拒绝 root 装服务等 | 容器伪影（CI 为非 root runner）|
| 环境缺件（ssh×5 / IPv6 双栈×2 / sqlite 报错文案×1）| 8 | 无 openssh-client；容器无 IPv6 故仅绑 `0.0.0.0`；容器 sqlite 构建的索引损坏报错措辞与断言文本不同 | 容器伪影 |
| 运行器环境敏感（`test_vision_routing_31179`）| 1 | 隔离运行器下稳定红、同文件裸 pytest 独立跑 8/8 绿 | 疑上游测试自身环境敏感（HEAD 与 tag 两版行为一致）|

## 附带事实

- agent 核心模块单独口径：325 文件 / 3,356 通过 / 1 失败（即上表环境敏感例），121 秒。
- 首钉 HEAD（`f86693c2`，2026-08-02）与 tag 版冒烟行为一致；pin 已按「release tag 优先」策略
  换轨 `v2026.7.30`（决策见 `memory/decisions.md` 2026-08-02 条⑤，台账 `projects/silver-core-hermes/UPSTREAM.md`）。
- 过程教训已入 `UPSTREAM.md` 同步例程：树内跑过测试后必清生成物再 `git add -f`
  （`__pycache__` 内上游脱敏测试 .pyc 的假 Slack token 样本曾触发 GitHub 推送保护拒推）。

## 对 M1 评估轮的输入

1. 上游测试基建质量高（逐文件隔离 / LPT 切片 / 时长缓存 / keyless 防真调用），银芯容器可全量复现——**M1 深读评估可以「改动前后全量跑」为回归基线**。
2. 布局假红 22 例提示：若未来把上游套件纳入银芯巡检，须带排除集或在临时 git 化的检出里跑。
3. `-m 'not integration'` 为默认口径；integration 标记测试（真 API / 真浏览器）本轮未跑，属已知未覆盖面。

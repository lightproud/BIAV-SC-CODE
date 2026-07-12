# silver-core-sdk 通宵质量攻坚战报（自补充循环批）

日期：2026-07-13（北京时间凌晨批）· 派单：守密人「能干一整晚的活 = 自我补充的循环」三线令
执行会话：claude/sdk-migration-0.3x-0.52-036p3p · 版本窗口：v0.52.0 → v0.52.1（零运行时行为变更）

## 一、战役定性

三条自补充循环线并行八小时：**变异测试歼灭战**（每个存活变异体 = 一个测试盲区，杀完再跑再杀）、
**属性测试与字节级模糊**（每个反例 = 一个新测试）、**仿真器浸泡**（墙钟本身产出资源曲线）。
工作量由发现驱动，天亮结算。全程零密钥（仿真器打底）、零守密人裁定依赖、每批独立小 PR 过 required test。

小学生比喻：变异测试是「故意拧坏每颗螺丝看警报响不响」；属性测试是「让机器人乱按一万次按钮找卡壳」；
浸泡是「让发动机空转一整夜看漏不漏油」。

## 二、主线战果：变异测试（Stryker，inPlace 模式）

| 模块 | 变异体 | 首轮 | 终轮 | 无覆盖清零 | 歼灭测试 |
|---|---|---|---|---|---|
| permissions（九步判定序） | 589 | 79.97%（471杀/82存/36无覆盖） | **92.87%**（547杀/42存/0无覆盖） | 36→0 | 49（两轮） |
| transport（韧性四层+SSE+双传输） | 1,813 | 67.77%（1,224杀/445存/137无覆盖/7错误） | ****71.04%**（1,283杀含超时/407存/116无覆盖/7错误）；逐档：node-http 65.35→**83.17**、watchdog 75.61→**92.68**、sse 82.95→**87.60**、anthropic 72.22→**77.24**、factory 100 持平、openai 62.81 未动（按纪律入盲区台账）** | 137→116 | 25（批一） |
| sessions | 未开轮（时间截止，排入后续） | — | — | — | — |

- permissions 残余 42 存活中已逐个论证等价者约 20（junk 规则不可匹配、hook 可选链在可达路径恒有对象、
  segmentMode 仅 'all' 有区分度等），论证入 `tests/permissions-mutation-kills*.test.ts` 尾注。
- transport 歼灭聚焦韧性臂：SSE 字段文法边角 + 中止路径、stall 看门狗全生命周期、node-http 头规整/
  空体/优先级/预连、**Retry-After HTTP-date 臂整段无覆盖被补齐**（0.48.3 只测了数字形式——
  服务器用日期说「等到几点」的线路此前没通过电）。
- **盲区台账（未歼灭，留后续战役）**：openai.ts 翻译传输 360 存活 + 109 无覆盖为最大洞
  （idealab 网关走此臂，值得专场）；anthropic.ts 残余 ~130（退避抖动界、abort 监听清理等）；
  engine/loop.ts 与 sessions/ 未开轮。工具：`npx stryker run --mutate "src/<dir>/**/*.ts"`。

## 三、支线战果：属性测试（fast-check，进 npm test 常驻）

| 高危面 | 不变量 | 随机场景量 | 结果 |
|---|---|---|---|
| SSE 解析器 | P1 任意字节切块不变（含 UTF-8 多字节切割）/ P2 噪声免疫 / P3 任意截断不抛且尾帧为真前缀 | ~700/轮 | 全绿 |
| 权限门偏序 | deny 支配（变形法：任何 allow 规则/模式/放行回调不得加宽 deny）/ 无静默放行 / 只读放行不惊动回调 / 垃圾规则全域性 | ~840/轮 | 全绿 |
| 会话 JSONL | 任意行损坏/截断：内容不可发明、不抛；损坏后 resume 完成或类型化失败、绝不挂死 | ~105/轮 | 全绿 |

**反例产出（属性测试的真价值）**：会话损坏 P1 首轮反例「删第 0 行（meta）→ 视图 uuid 全变」，
顺藤定性出待裁发现 #1（见五）。属性随后改为内容级不变量锁定当前诚实契约。

## 四、后台线战果：仿真器浸泡

Run: 127.7 min · 584,106 sessions · 1,724,832 turns · 116,821 resumes · 27,316 forks · 144,137 compaction folds · 0 errors

Mix: sequential real sessions against the local Messages-API emulator — fresh / resume-chain (every 5th) / fork (every 17th), 2-tool loop + fat text turn per session, tiny compaction window (deterministic folds), store rotation every 200 sessions.

| metric | start | end | min..max | steady-state slope /h | verdict |
|---|---|---|---|---|---|
| rss_mb | 82 | 212 | 82..227 | +0.34 | FLAT |
| heap_used_mb | 15 | 44 | 15..106 | -0.00 | FLAT |
| external_mb | 4 | 5 | 4..7 | +0.02 | FLAT |
| array_buffers_mb | 0 | 2 | 0..3 | +0.02 | FLAT |
| handles | 1 | 2 | 1..3 | -0.00 | FLAT |
| fds | 23 | 25 | 23..26 | +0.00 | FLAT |

Throughput: 4574 sessions/min, 13507 turns/min (4-core container, concurrent with other load).

Reading the verdicts: FLAT within budget = no leak signal at this horizon; GROWING rss with FLAT heap usually means allocator retention, check external/arrayBuffers; GROWING handles or fds is a hard leak regardless of memory.

结论：**无泄漏信号**——六指标全 FLAT（rss 斜率在预算内、句柄/fd 恒定），
百万轮级真实栈（真 HTTP/SSE/引擎环/工具落盘/JSONL 持久化 + resume/fork/强制压缩折叠混合）零错误。
探针与报告生成器已入库：`tests/integration/soak-emulator.mjs` / `soak-report.mjs`（零钥可复跑）。

## 五、待裁清单（语义拿不准，未擅改）

1. **会话消息 uuid 不落盘、读取时随机现铸**：user/assistant 记录仅存 type/timestamp/message；
   `getSessionMessages` 每次读取现铸 uuid，同一档案两次读取 uuid 全不同（幂等性 = false）。
   官方表面语义隐含 uuid 可对账（0.40.0 `parent_agent_id` 即「from persisted metadata」）。
   若裁「补齐」：写入时落 uuid、读取容旧（无 uuid 的历史行照旧现铸或按行号派生），patch 级；
   若裁「维持」：在 COMPAT.md 记诚实边界一行。比喻：图书馆的书没有固定索书号，
   每次借阅现编一个——书还在，但两张借书单对不上号。
2. openai.ts 变异大洞是否专场歼灭（360 存活 + 109 无覆盖，黑池 idealab 网关走此臂）——预算裁定。

## 六、已裁已办报备（门禁类养护，非语义变更）

- **KB 语义黄金集养护**（PR #653）：sem-cl-01 因当日归档的 Cowork 设计文档给 KB 添了
  沙耶↔saya 跨语言桥而被脊柱够到（题目前提「零共享 token」失效），按题集自带诚实纪律
  **原位换题** sem-cl-04（reddit 真实存档标题，容量 17 不减，退役缘由入 provenance.replaces）。
  main 门禁红→绿。请守密人过目认可此次换题。

## 七、PR 台账与总量

| PR | 内容 | 测试增量 |
|---|---|---|
| #653 | KB 黄金集养护（main 门禁修复） | ±0（11 守卫复绿） |
| #654 | v0.52.1 质量工装：Stryker+fast-check+浸泡探针+permissions 歼灭批一 | +48 |
| #655 | permissions 歼灭批二（存活者分诊） | +10 |
| #656 | transport 歼灭批一（韧性臂） | +25 |
| 本报告 PR | 战报归档 | — |

SDK 套件规模：会话开始 1,885 绿 → 2,003绿 + 2 skipped；仓根 pytest 2,911 绿 + 12 skipped。
全程 `tsc`/`build` exit 0；版本纪律三源一致（0.52.1）。

## 八、复跑手册（循环继续的入口）

```bash
cd projects/silver-core-sdk
npx stryker run                                        # permissions（stryker.conf.json 默认）
npx stryker run --mutate "src/transport/**/*.ts"       # transport
npx stryker run --mutate "src/sessions/**/*.ts"        # sessions（下一站）
node tests/integration/soak-emulator.mjs --duration-min=480 --snapshot-sec=300 --out=/tmp/soak.jsonl
node tests/integration/soak-report.mjs --in=/tmp/soak.jsonl
```
存活清单提取：读 `reports/mutation/mutation.json`（gitignored，跑完即有）按 status 过滤。

# evals/ — 行为评估基准(SCS-REQ-002 环二)

自我改进闭环的评估基准层(需求书 `memory/active/self-improvement-requirements.md` §5.2)。
双层结构:**底线层** = 全量确定性测试(`npm test`,pass/fail,守「不坏」);**行为层** =
本目录 20 题评估集,LLM 评分 1–5,衡「变好」。一条命令跑双层:`node scripts/run-evals.mjs`。

## 治理规则(硬约束)

1. **题库定稿权归维护者(守密人)**。当前题集为 **r0 草案**(艾瑞卡按 2026-07-11
   裁定的混合来源起草:真实故障提炼 14 题 + 维度盲区人工构造 6 题),逐题
   `status: "draft"`;守密人逐题复核改定后升 `status: "final"`,基线分自 final
   版起算。
2. **agent 不得修改本目录**(REQ-2.1「防改考题」红线)。环三自我改进任务产出的
   PR 若触碰 `evals/` 一律拒绝——Phase 3 上线时接 CI 硬拒;当前由
   `MANIFEST.sha256` + `tests/evals-governance.test.ts` 提供防篡改证据:任何
   改动必须同步重生成清单(`node scripts/update-evals-manifest.mjs`),漂移即测试红。
3. **评分模型与提示词固定**(守密人 2026-07-11 裁定,`memory/decisions.md`
   「SCS-REQ-002 阻塞项四裁定」条):judge = `claude-sonnet-5`,评分提示词 =
   `judge-prompt.md`(逐字固定,改动 = 基线重置,须记录);判卷侧预算帽 $30/月,
   夜间批跑走 Batches API。

## 文件

| 文件 | 内容 |
|---|---|
| `behavior/questions.json` | 20 题(三维度:memory_recall 7 / disconnect_recovery 6 / token_efficiency 7) |
| `judge-prompt.md` | 固定评分提示词(1–5 锚定评分 + 结构化输出) |
| `MANIFEST.sha256` | 本目录全文件 SHA-256 清单(防篡改证据) |

## 题目 schema

```jsonc
{
  "id": "mem-01",                       // 维度前缀 + 序号
  "dimension": "memory_recall",         // memory_recall | disconnect_recovery | token_efficiency
  "source": "distilled",                // distilled(真实故障提炼)| constructed(人工构造)
  "status": "draft",                    // draft(r0)| final(守密人定稿)
  "title_zh": "……",
  "scenario": "……",                     // 场景与执行方式(英文,喂给被测/判卷模型)
  "harness": { "driver": "prompt-session" | "manual", ... },
  "rubric": ["…", "…"]                  // 判分锚点(judge 逐点核对)
}
```

`driver: "prompt-session"` 的题可由 `run-evals.mjs` 在 live 模式(有
`ANTHROPIC_API_KEY`)自动执行并判卷;`driver: "manual"` 的题需故障注入 harness
(Phase 2/3 建),运行器将其显式记为 `PENDING_HARNESS` 并排除出分母——绝不静默略过。

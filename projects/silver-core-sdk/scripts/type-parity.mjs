#!/usr/bin/env node
/**
 * 类型面漂移检测：本 SDK 的工具 Input/Output 类型 vs 官方 `sdk-tools.d.ts`，
 * 按**嵌套点号路径**比对。
 *
 * 为什么把三轮手搓脚本收成一条命令（守密人 2026-07-27「按你建议继续」）：
 * 2026-07-27 一天里对官方发行物扫了三轮，**每一轮都挖到东西**，而第三轮挖到的
 * 恰恰是第二轮当天引入的（`timedOutAfterMs` 待错了类型）。三轮都是跑完即弃的
 * 临时脚本，于是「上次扫到哪、哪些已经裁过」全靠人记——而这正是漂移能反复回来的
 * 原因。
 *
 * **本命令的价值不在于重跑比对，在于只报「新的」**：已经守密人裁定过的差异写进
 * 下面的 RULED 白名单，跑起来自动扣除，剩下的才是上次之后**新长出来的**。一份每次
 * 都吐同样 40 条已知差异的报告，人第二次就不看了——那种清单等于没有。
 *
 * 与既有两把尺子同族、同纪律：
 * - `description-coverage.mjs` 量描述散文的吻合度；
 * - 本命令量类型面的形状；
 * - 两者都是**报告体，恒 exit 0**。理由相同：差异**本就不该为零**——红线纪律禁止
 *   声明/描述未发货能力，硬拉平等于逼类型面去承诺本包做不到的事。判断哪条该补、
 *   哪条该记档，是人的活。
 *
 * 官方 d.ts 从哪儿来：`@anthropic-ai/claude-code` 包里带 `sdk-tools.d.ts`（本仓
 * conformance 作业本就 `--no-save` 装它作对照臂，属净室边界①「官方发行渠道产物」）。
 * 找不到就打印取法并 exit 0——一把尺子不该因为没量到而把别人的流水线判红。
 *
 * 用法：
 *   node scripts/type-parity.mjs [--official <sdk-tools.d.ts>] [--all] [--json]
 *     --all   连已裁定的差异一起列（默认只报新漂移）
 *     --json  机器可读输出
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');
const OUR_TYPES = join(PKG, 'src', 'types', 'tools.ts');

/** 官方 d.ts 的候选位置，按可信度排序。 */
const OFFICIAL_CANDIDATES = [
  join(PKG, 'node_modules', '@anthropic-ai', 'claude-code', 'sdk-tools.d.ts'),
  join(PKG, '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'sdk-tools.d.ts'),
];

/**
 * 已裁定的差异（守密人 2026-07-27 逐条裁定，理由全文见 docs/COMPAT.md 三节
 * 「Divergence sweep」/「Output-type sweep」/「Nested-path sweep」）。
 *
 * 键 = `类型名:路径`。**写进这里不等于「不重要」，等于「已经看过并且决定了」**——
 * 每一条都对应一句「本 SDK 没有那个 UI / 云侧机制 / 解析器，声明它就是描述未发货
 * 能力」。新条目只能由守密人裁定后加入，否则这份白名单会变成掩盖漂移的地毯。
 */
const RULED = new Set([
  // 官方权限组件 UI 的回程字段（输入与输出两侧同裁）
  'AskUserQuestionInput:answers', 'AskUserQuestionInput:annotations',
  'AskUserQuestionInput:metadata', 'AskUserQuestionOutput:answers',
  'AskUserQuestionOutput:annotations', 'AskUserQuestionOutput:afkTimeoutMs',
  // 官方 WebSocket 监视源
  'MonitorInput:ws', 'MonitorInput:url', 'MonitorInput:protocols',
  // 官方编辑器集成 / 计划编辑 UI
  'FileWriteOutput:userModified', 'ExitPlanModeOutput:planWasEdited',
  // 官方远程任务模型（本 SDK 同步跑工作流，必填判别式 async_launched 即断言未发生的启动）
  'WorkflowOutput:sessionUrl', 'WorkflowOutput:taskType',
  'WorkflowOutput:workflowName', 'WorkflowOutput:warning',
  // 官方解析 git/gh 命令输出成结构化 VCS 事实——本 SDK 只跑 shell、不解析其输出
  'BashOutput:gitOperation', 'BashOutput:ghRateLimitHint',
  'BashOutput:staleReadFileStateHint', 'BashOutput:backgroundCwdHint',
  'BashOutput:noOutputExpected',
  // Anthropic artifacts / 二进制落盘 / git 仓库名——本 SDK 无对应设施
  'WebFetchOutput:artifactRead', 'ReadMcpResourceOutput:contents.blobSavedTo',
  'FileWriteOutput:gitDiff.repository', 'FileEditOutput:gitDiff.repository',
  'WebSearchOutput:searchCount',
  // Read 按**字符**计、官方按 token 计（守密人 2026-07-27 交付单 §4 明裁不改计量单位）。
  // 同名不同单位比不同名更坏——读起来像对齐、跑起来是漂移，故本 SDK 另立
  // `truncatedByCharCap`，官方这个字段永久不补。
  'FileReadOutput:file.truncatedByTokenCap',
  // 官方靠这对字段报「截断前共多少」；本引擎的 rg 流式读到上限即停，
  // 拿不到未截断总数，填即编造（理由全文见 src/types/tool-outputs.ts 头注）。
  'GrepOutput:totalFiles', 'GrepOutput:totalLines',
  // ---- 守密人 2026-07-27 第二批裁定（「整体记档并入白名单」）----
  // 官方子代理遥测 / worktree 会计 / 远程任务模型。本 SDK 的 Agent 工具连结构化
  // 产出方都还没有（见 docs/COMPAT.md「零产出 Output 类型台账」），在没有产出方的
  // 前提下讨论补哪个字段是顺序反了；要动先立产出方。
  'AgentOutput:agentType', 'AgentOutput:modelsUsed', 'AgentOutput:content.citations',
  'AgentOutput:toolStats', 'AgentOutput:usage.inference_geo',
  'AgentOutput:usage.speed', 'AgentOutput:usage.iterations',
  'AgentOutput:worktreePath', 'AgentOutput:worktreeBranch',
  'AgentOutput:isAsync', 'AgentOutput:sessionUrl', 'AgentOutput:taskId',
  // 官方 teams，本 SDK 无此设施。
  'AgentInput:team_name',
  // 挂在官方 `file_unchanged` 结果分支上（启动期预置 CLAUDE.md 去重）。本 SDK
  // 没有那条分支，缺的是**整条分支**而非一个字段——展平比对只露出该分支独有的
  // 那个字段，此为其固有盲区，已在 COMPAT.md 写明。
  'FileReadOutput:source',
]);

/** 官方名 -> 本 SDK 名（同物异名）。 */
const ALIASES = { FileRead: 'Read', FileWrite: 'Write', FileEdit: 'Edit' };

/**
 * 名字 -> 类型体文本（第一个 `{` 到配平的 `}`）。刻意做成结构近似而非真 TS 解析：
 * 两边用同一套规则，系统性偏差在差集里互相抵消。真正的风险是**某一侧解析飞了**，
 * 所以每个类型都同时报键总数——数量级不对说明解析出问题，不是类型真有差异。
 */
export function typeBlocks(text) {
  const out = {};
  const re = /export\s+(?:interface|type)\s+([A-Za-z]\w*)\s*(?:=\s*)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // 声明头与 `{` 之间只准夹空白和联合竖线。用「距离够近」当判据是不行的——
    // `export type Alias = SomethingElse;` 后面 39 个字符处正好是下一个类型的
    // 花括号，纯别名于是吞掉邻居的整个类型体（本测试第 4 例即此）。
    let cursor = m.index + m[0].length;
    const arms = [];
    for (;;) {
      const gap = /^[\s|]*/.exec(text.slice(cursor))[0];
      const brace = cursor + gap.length;
      if (text[brace] !== '{') break;
      let depth = 0;
      let end = -1;
      for (let k = brace; k < text.length; k++) {
        if (text[k] === '{') depth++;
        else if (text[k] === '}' && --depth === 0) {
          end = k;
          break;
        }
      }
      if (end < 0) break;
      arms.push(text.slice(brace, end + 1));
      cursor = end + 1; // 联合的下一支：`| { … } | { … }` 全部收进同一个类型
    }
    if (arms.length > 0 && !(m[1] in out)) out[m[1]] = arms.join('\n');
  }
  return out;
}

/**
 * 类型体 -> 嵌套点号路径集合。
 *
 * 三处刻意的取舍，都是为了让**两侧对称**——比对的是差集，系统性偏差只要两边一致
 * 就会自己抵消，真正致命的是只在一侧发生的偏差：
 *
 * 1. **索引签名整条抹掉**（`[k: string]: T`）。官方把开放字典写成内联索引签名，本 SDK
 *    写成 `Record<string, T>`；后者根本没有键名可抽。若不抹，官方侧会平白多出一个叫
 *    `k` 的幽灵字段（首跑就误报了 `metadata.k` / `answers.k` / `args.k` 四处）。
 * 2. **分号重置 pending、右花括号把 pending 还原成弹出的那个父名**。官方把
 *    `@minItems/@maxItems` 展开成元组字面量（`AskUserQuestionInput` 一个类型就 83KB），
 *    于是 `}` `,` `{` 与 `] | [ {` 连着出现。不还原父名，元组第 2..N 个元素就会挂错地方：
 *    要么挂到上一个元素**最后一个字段**名下（凭空造出 `multiSelect.header`），要么整个
 *    掉到顶层（凭空造出裸 `header` / `label`）。还原后第 2..N 个元素与第 1 个同父，
 *    Set 去重，信息零损失。
 * 3. 注释先剥离——官方 d.ts 的 JSDoc 里全是 `example: "..."` 之类，不剥会被当字段。
 */
export function flatten(body) {
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const paths = new Set();
  const stack = [];
  let pending = null;
  // 索引签名先于普通键匹配，否则 `[k: string]` 里的 `k:` 会被当成字段名
  const tok = /\[\s*[\w$]+\s*:\s*(?:string|number)\s*\]\s*\??\s*:|["']?([\w$-]+)["']?\s*\??\s*:|[{};]/g;
  let m;
  while ((m = tok.exec(stripped)) !== null) {
    if (m[0] === '{') {
      stack.push(pending);
      pending = null;
    } else if (m[0] === '}') {
      pending = stack.pop() ?? null;
    } else if (m[0] === ';') {
      pending = null;
    } else if (m[1] === undefined) {
      pending = null; // 索引签名：进得去下一层，但自己不产生路径
    } else {
      paths.add([...stack.filter(Boolean), m[1]].join('.'));
      pending = m[1];
    }
  }
  return paths;
}

/** RULED 条目吸收整棵子树：裁掉 `BashOutput:gitOperation` 即裁掉它底下所有字段。
 *  否则每加一个已裁父节点，报告里仍会冒出它的一串孩子——那就是白名单形同虚设。 */
function isRuled(type, path) {
  if (RULED.has(`${type}:${path}`)) return true;
  let cut = path.lastIndexOf('.');
  while (cut > 0) {
    if (RULED.has(`${type}:${path.slice(0, cut)}`)) return true;
    cut = path.lastIndexOf('.', cut - 1);
  }
  return false;
}

function resolveOfficial(argPath) {
  if (argPath) return existsSync(argPath) ? argPath : null;
  return OFFICIAL_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const showAll = argv.includes('--all');
  const officialArg = argv[argv.indexOf('--official') + 1];
  const official = resolveOfficial(argv.includes('--official') ? officialArg : undefined);

  if (official === null) {
    console.error(
      '官方 sdk-tools.d.ts 未找到。取法（净室边界①：官方发行渠道产物）：\n' +
        '  npm i --no-save @anthropic-ai/claude-code\n' +
        '然后重跑，或用 --official <路径> 指定。\n' +
        '（本命令是尺子不是门禁，量不到也不把流水线判红。）',
    );
    return 0;
  }

  const off = typeBlocks(readFileSync(official, 'utf8'));
  const ours = typeBlocks(readFileSync(OUR_TYPES, 'utf8'));

  const rows = [];
  for (const [name, body] of Object.entries(off)) {
    if (!/(Input|Output)$/.test(name)) continue;
    // 官方名先按别名映射，再退回同名
    const base = name.replace(/(Input|Output)$/, '');
    const suffix = name.endsWith('Input') ? 'Input' : 'Output';
    const ourName = (ALIASES[base] ?? base) + suffix;
    const ourBody = ours[ourName] ?? ours[name];
    if (ourBody === undefined) continue; // 本 SDK 不发货该工具：不是漂移，是范围
    const a = flatten(body);
    const b = flatten(ourBody);
    const onlyOfficial = [...a].filter((p) => !b.has(p));
    const onlyOurs = [...b].filter((p) => !a.has(p));
    const newDrift = onlyOfficial.filter((p) => !isRuled(name, p));
    rows.push({
      type: name,
      ourType: ourName,
      officialKeys: a.size,
      ourKeys: b.size,
      onlyOfficial: onlyOfficial.sort(),
      onlyOurs: onlyOurs.sort(),
      newDrift: newDrift.sort(),
    });
  }

  const drifted = rows.filter((r) => r.newDrift.length > 0);
  if (asJson) {
    console.log(JSON.stringify({ official, types: rows.length, drifted, rows }, null, 2));
    return 0;
  }

  console.log(`官方 d.ts：${official}`);
  console.log(`比对类型 ${rows.length} 个；已裁定差异 ${RULED.size} 条（自动扣除）\n`);
  for (const r of rows) {
    const show = showAll ? r.onlyOfficial : r.newDrift;
    if (show.length === 0 && !showAll) continue;
    const tag = r.newDrift.length > 0 ? '★新漂移' : '  已裁定';
    console.log(
      `${tag} ${r.type.padEnd(24)} 键 ${String(r.officialKeys).padStart(3)}/${String(r.ourKeys).padStart(3)}  ` +
        `官方独有: ${show.join(', ') || '-'}`,
    );
    if (r.onlyOurs.length > 0) console.log(`${' '.repeat(9)}银芯独有: ${r.onlyOurs.join(', ')}`);
  }
  console.log(
    drifted.length === 0
      ? '\n无新漂移：官方独有的字段全部已裁定在案。'
      : `\n新漂移 ${drifted.length} 个类型——每条都要人裁「补上」还是「记档」，别默认补。`,
  );
  console.log('键数是解析健康度的哨兵：某一侧数量级不对 = 解析飞了，不是类型真有差异。');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());

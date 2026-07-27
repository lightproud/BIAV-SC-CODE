#!/usr/bin/env node
/**
 * 描述基准吻合度：本 SDK 的每条工具描述，对它所引用的快照档案还剩多少逐字吻合。
 *
 * 为什么要有这个命令（守密人 2026-07-27 裁定「3 也直接对齐基准」）：本 SDK 的对照基准
 * 一直是**一次性的人工快照**——0.80.0 那批常量取自 2.1.141 的 claude.exe，描述层则对着
 * 更早的重建档写成。上游同期已经跑到 2.1.216+。「基准漂没漂」此前只能靠人手抄着比，
 * 于是它从来没被真正比过；本命令把它变成一条随时能跑的命令。
 *
 * 与 `tests/tool-descriptions-provenance.test.ts` 的分工——**它是门禁，本命令是尺子**：
 * 守卫只问「这条描述还认不认得它的出处」（每档至少一个稳定锚点仍在，低于此即红），
 * 因为吻合度**本来就不该是 100%**：本 SDK 刻意不复刻未发货能力（红线纪律），
 * WebFetch 没有摘要层、Monitor 只有轮询面、EnterWorktree 砍掉一半机制。
 * 把守卫拉到 100% 等于强迫描述去吹本包做不到的事。所以吻合度是**给人看的信号**，
 * 不是门禁：低分要么是「已登记的改编」，要么是「上游加了新话我们还没跟」，
 * 二者只能人来分。**本命令恒 exit 0。**
 *
 * 口径：把档案正文切成句，丢掉带 `${...}` 模板变量的句子（那些本就要被解析成本包的具体
 * 值），剩下的「稳定句」逐条看是否仍在本包描述里逐字出现。取前 45 字符比对，与守卫同口径。
 *
 * **测不到什么，明写**：重建档把数字上限模板化了（`${MAX_LINES_CONSTANT}` 一类），
 * 所以 Read 25,000 token / Bash 30,000 / WebFetch 100,000 这类**数值常量在仓内无法核验**——
 * 它们只存在于 claude.exe 里。本命令量的是**散文吻合度**，数值基准的重新提取需要守密人
 * 在本机再跑一次二进制提取。这条边界不写出来，报告就会被误读成「常量也对齐了」。
 *
 * 用法：node scripts/description-coverage.mjs [--json] [--min=<百分比>]
 *      （--min 只影响打印时的高亮，不影响退出码）
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');
const ARCHIVE = join(PKG, '..', '..', 'Public-Info-Pool', 'Reference',
  'Claude-Code-System-Prompts', 'system-prompts');

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const stripHeader = (md) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

/** 档案头注释里的 ccVersion —— 必须在 stripHeader 之前取，它就写在那段注释里。 */
function ccVersion(raw) {
  const m = raw.match(/ccVersion:\s*["']?([0-9][0-9.]*)/);
  return m ? m[1] : 'unknown';
}

function stableSentences(body) {
  return body
    .split(/(?<=[.:])\s+/)
    .map(norm)
    .filter((s) => s.length >= 40 && !s.includes('${'));
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const min = Number((args.find((a) => a.startsWith('--min=')) || '--min=100').slice(6));

  const distIndex = join(PKG, 'dist', 'tools', 'descriptions.js');
  if (!existsSync(distIndex)) {
    console.error('先 `npm run build`：本命令读 dist/ 里编译好的描述常量。');
    return 0; // 报告体：连尺子都没拿到也不该把别人的流水线判红
  }
  const { TOOL_DESCRIPTION_PROVENANCE, TOOL_DESCRIPTION_TEXT } = await import(distIndex);

  if (!existsSync(ARCHIVE)) {
    console.error(`快照层不在（${ARCHIVE}）——独立包解压态没有它，跳过。`);
    return 0;
  }

  const rows = [];
  for (const p of TOOL_DESCRIPTION_PROVENANCE) {
    const desc = norm(TOOL_DESCRIPTION_TEXT[p.tool] ?? '');
    for (const slug of p.slugs) {
      const file = join(ARCHIVE, `${slug}.md`);
      if (!existsSync(file)) {
        rows.push({ tool: p.tool, slug, ccVersion: null, faithful: p.faithful,
                    hit: 0, total: 0, coverage: null, missing: ['<档案缺失：引用指空>'] });
        continue;
      }
      const raw = readFileSync(file, 'utf8');
      const sents = stableSentences(norm(stripHeader(raw)));
      const missing = sents.filter((s) => !desc.includes(s.slice(0, 45)));
      rows.push({
        tool: p.tool, slug, ccVersion: ccVersion(raw), faithful: p.faithful,
        hit: sents.length - missing.length, total: sents.length,
        // 全模板档没有稳定句可比 —— 记 null（无法测量），不记 100%（测过且满分）。
        coverage: sents.length ? Math.round((100 * (sents.length - missing.length)) / sents.length) : null,
        missing: missing.map((s) => s.slice(0, 160)),
      });
    }
  }

  rows.sort((a, b) => (a.coverage ?? 999) - (b.coverage ?? 999));

  if (asJson) {
    console.log(JSON.stringify({ archive: ARCHIVE, rows }, null, 2));
    return 0;
  }

  const versions = [...new Set(rows.map((r) => r.ccVersion).filter(Boolean))].sort();
  console.log(`快照层 ccVersion 分布：${versions.join(' / ')}`);
  console.log('（数值上限在重建档里是模板变量，仓内无法核验——本表只量散文吻合度）\n');
  for (const r of rows) {
    const cov = r.coverage === null ? (r.total === 0 && r.ccVersion ? ' 全模板' : ' 引用指空') : `${String(r.coverage).padStart(4)}%`;
    const flag = r.coverage !== null && r.coverage < min ? ' ←' : '';
    console.log(`${cov}  ${r.tool.padEnd(16)} ${r.slug.slice(0, 54).padEnd(54)} ` +
                `${(r.ccVersion ?? '-').padEnd(8)} ${r.hit}/${r.total} ` +
                `${r.faithful ? 'faithful' : 'adapted '}${flag}`);
  }
  const dangling = rows.filter((r) => r.ccVersion === null);
  if (dangling.length) {
    console.log(`\n引用指空 ${dangling.length} 条——这是真缺陷，守卫会红：` +
                dangling.map((r) => `${r.tool}/${r.slug}`).join(', '));
  }
  return 0;
}

main().then((code) => process.exit(code));

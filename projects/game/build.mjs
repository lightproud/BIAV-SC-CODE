// 将 config/*.json（唯一事实源）打包成浏览器可直接 file:// 加载的 config.js。
// 用法：node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfgDir = join(here, 'config');
const files = ['characters', 'weapons', 'enemies', 'waves', 'upgrades'];
const bundle = {};
for (const f of files) bundle[f] = JSON.parse(readFileSync(join(cfgDir, f + '.json'), 'utf8'));

const out = '// 自动生成（node build.mjs）。请勿手改，改 config/*.json 后重新生成。\n'
  + 'window.GAME_CONFIG = ' + JSON.stringify(bundle, null, 2) + ';\n';
writeFileSync(join(cfgDir, 'config.js'), out);
console.log('config.js 已生成：', files.map(f => f + '.json').join(', '));

export function loadConfig() { return bundle; }

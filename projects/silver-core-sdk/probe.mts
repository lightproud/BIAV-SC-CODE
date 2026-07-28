import { ruleMatches, parseRule } from './src/permissions/rules.ts';
function deny(specRule: string, cmd: string): boolean {
  return ruleMatches(parseRule(specRule), 'Bash', { command: cmd }, 'any');
}
const cases: [string, string][] = [
  ['Bash(rm:*)', 'if true; then rm -rf /; fi'],
  ['Bash(rm:*)', 'for x in a; do rm -rf /; done'],
  ['Bash(rm:*)', 'while true; do rm -rf /; done'],
  ['Bash(rm:*)', 'then rm -rf /'],
  ['Bash(rm:*)', 'do rm -rf /'],
  ['Bash(rm:*)', 'else rm -rf /'],
  ['Bash(rm:*)', "$'rm' -rf /"],
  ['Bash(rm:*)', 'if rm -rf /; then echo x; fi'],
  ['Bash(rm:*)', 'rm -rf /'],
  ['Bash(rm:*)', 'sudo rm -rf /'],
];
for (const [r, c] of cases) {
  const d = deny(r, c);
  console.log((d ? 'DENY ' : 'MISS*') + '  ' + JSON.stringify(c) + '   [' + r + ']');
}

console.log('--- allow-position regression (should NOT auto-allow denied-word forms; allowed should) ---');
function allowMatch(specRule: string, cmd: string): boolean {
  return ruleMatches(parseRule(specRule), 'Bash', { command: cmd }, 'all');
}
const acases: [string,string,boolean][] = [
  ['Bash(git:*)', 'if true; then git status; fi', false], // grouped -> allow must NOT fire (falls to prompt)
  ['Bash(git:*)', 'git status', true],
  ['Bash(if:*)', 'if true', true], // literal allow still works
];
for (const [r,c,exp] of acases) {
  const m = allowMatch(r,c);
  console.log((m===exp?'ok  ':'REG!')+' allow '+JSON.stringify(c)+' ['+r+'] got='+m+' exp='+exp);
}

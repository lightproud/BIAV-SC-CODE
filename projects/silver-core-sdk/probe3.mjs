import { assembleMainLoop } from './src/engine/prompt-assembler.js';
// Tools that, if named in the prompt but absent from the set, = red-line leak.
const gatedTools = ['Read','Write','Edit','Grep','Glob','Bash','TaskCreate','TaskGet','TaskUpdate','TaskList','TodoWrite','Agent','AskUserQuestion','WebFetch','WebSearch','memory'];
// Regex to detect a tool named as the DEDICATED tool (capitalized standalone).
function mentions(text, tool) {
  // word-boundary, exclude lowercase generic verbs like grep
  return new RegExp(`\\b${tool}\\b`).test(text);
}
const sets = [
  ['Read','Edit'],                         // no Write
  ['Bash','Read','Grep','Glob','Edit'],    // no Write
  ['TaskCreate','TaskGet','TaskUpdate'],   // no TaskList
  ['WebFetch'],                            // no WebSearch
  ['WebSearch'],                           // no WebFetch
  ['Read','Write','Edit','Grep','Glob','Bash','TaskCreate','TaskGet','TaskUpdate','TaskList','Agent','AskUserQuestion','WebFetch','WebSearch'],
];
for (const set of sets) {
  const out = assembleMainLoop({ toolNames: set });
  const present = new Set(set);
  const leaks = gatedTools.filter(t => !present.has(t) && mentions(out, t));
  console.log('set=['+set.join(',')+']  leaks:', leaks.length? leaks : 'none');
}

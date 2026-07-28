import { buildEngineConfig } from '../src/engine/config-builder.js';
import { deriveSystemField } from '../src/engine/system-field.js';
import { applyCacheControl } from '../src/engine/cache-control.js';

for (const segs of [[], [{ text: 'A' }, { text: 'B' }], [{ text: 'A', cache: true }]]) {
  const { engineConfig } = buildEngineConfig({
    options: { systemPrompt: { type: 'segments', segments: segs as never }, settingSources: [] },
    cwd: '/tmp/proj', initialModel: 'claude-sonnet-4-5', builtinToolNames: ['Read'], debug: () => {},
  });
  const d = deriveSystemField(engineConfig);
  const out = applyCacheControl(
    { model: 'm', max_tokens: 1, system: d.system, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [{ name: 't', description: '', input_schema: { type: 'object' } }] } as never,
    { enabled: true, cacheMessages: !d.callerBlocks, cacheSystemBoundary: d.boundary },
  );
  console.log(JSON.stringify({ segs: segs.length, system: d.system, callerBlocks: d.callerBlocks, msgCached: JSON.stringify(out.messages).includes('cache_control') }));
}

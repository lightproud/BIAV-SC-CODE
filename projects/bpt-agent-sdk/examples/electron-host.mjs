// Electron main-process host wiring, demonstrated as a plain-node script.
//
// This is the pilot-swap shape for BPT Desktop (docs/MIGRATION.md §3): all
// four host callbacks a desktop app must provide, streaming-input chat, the
// message pump a renderer would consume over IPC, and per-run metrics. Every
// `console.*` here stands in for an IPC send / dialog call — the markers show
// where Electron APIs slot in.
//
//   npm run build
//   ANTHROPIC_API_KEY=sk-... node examples/electron-host.mjs "list the files here"
//
// Without a key it prints the wiring and exits (nothing to demo against).

import readline from 'node:readline';

const { query } = await import('../dist/index.js');

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log('Set ANTHROPIC_API_KEY to run this example.');
  process.exit(0);
}

const userTask = process.argv[2] ?? 'What files are in the current directory?';

// --- host callback 1: permission dialog -------------------------------------
// Electron: dialog.showMessageBox({ buttons: ['Allow', 'Deny'] }) in main, or
// forward to the renderer for an in-chat approval card.
async function canUseTool(toolName, input, { suggestions }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const preview = JSON.stringify(input).slice(0, 120);
  const answer = await new Promise((resolve) =>
    rl.question(`[permission] ${toolName} ${preview}\n  allow? (y/N/a=always) `, resolve),
  );
  rl.close();
  if (answer.trim().toLowerCase() === 'a' && suggestions?.length) {
    // "Always allow": echo the SDK's own suggestion back as a session rule.
    return { behavior: 'allow', updatedInput: input, updatedPermissions: [suggestions[0]] };
  }
  if (answer.trim().toLowerCase() === 'y') {
    return { behavior: 'allow', updatedInput: input };
  }
  return { behavior: 'deny', message: 'Denied from the host UI' };
}

// --- host callback 2: AskUserQuestion as UI ---------------------------------
// Electron: render each question's options as buttons; resolve on click.
async function onUserQuestion(questions) {
  return questions.map((q) => {
    const first = q.options?.[0];
    console.log(`[question] ${q.question} (auto-answering "${first?.label ?? 'n/a'}")`);
    return { header: q.header, answers: first ? [first.label] : [] };
  });
}

// --- host callback 3: WebSearch backend -------------------------------------
// Electron: call your search API of choice; return [] to report "no results".
async function webSearch(q) {
  console.log(`[websearch] "${q}" (stub returns no results)`);
  return [];
}

// --- host callback 4: MCP elicitation ---------------------------------------
// Electron: show a form built from the server's requested schema.
async function onElicitation() {
  return { action: 'decline' };
}

// --- streaming-input chat: one open session, user turns pushed over time ----
// Electron: replace this generator with a queue fed by renderer IPC messages.
async function* userTurns() {
  yield {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: { role: 'user', content: userTask },
  };
}

const q = query({
  prompt: userTurns(),
  options: {
    provider: { apiKey: process.env.ANTHROPIC_API_KEY },
    canUseTool,
    onUserQuestion,
    webSearch,
    onElicitation,
    includePartialMessages: false, // renderer streaming: flip to true and pump stream_event
    maxTurns: 8,
    debug: false,
  },
});

// --- the message pump a renderer would consume over IPC ---------------------
for await (const msg of q) {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') console.log(`[init] model=${msg.model} tools=${msg.tools.length}`);
      break;
    case 'assistant': {
      const text = msg.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (text) console.log(`[assistant] ${text}`);
      break;
    }
    case 'task_started':
      console.log(`[task] ${msg.task_name} started`);
      break;
    case 'permission_denied':
      console.log(`[denied] ${msg.tool_name}: ${msg.reason}`);
      break;
    case 'result': {
      const m = msg.metrics;
      console.log(
        `[result] ${msg.subtype} turns=${msg.num_turns} ` +
          `cost=$${msg.total_cost_usd.toFixed(4)} ` +
          (m ? `cacheHit=${(m.cacheHitRatio * 100).toFixed(0)}% apiMs=${m.durationApiMs}` : ''),
      );
      break;
    }
    default:
      break; // stream_event / user echoes / other observability arms
  }
}

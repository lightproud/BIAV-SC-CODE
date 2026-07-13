/**
 * Mutation-kill tests: sessions module, batch 1 (keeper "1 3 推进" order;
 * baseline round scored 68.16% - 428 survived + 120 no-coverage across 7
 * files). This batch takes the two weakest surfaces:
 *  - tool-claims.ts (55.14%): the S4 claim-audit heuristics black-pool
 *    governance leans on - detector patterns, backing semantics, snippet
 *    line extraction, uuid threading, custom detector arrays.
 *  - store-adapter.ts (57.20%, 54 no-coverage): the external-sessionStore
 *    mirror's read-side fallbacks (list / latestSessionId / load), the
 *    exact surface a BPT host hits when it injects options.sessionStore -
 *    plus InMemorySessionStore listSessions/delete semantics.
 * The store.ts / checkpoints.ts / file-store.ts residue is ledgered for the
 * next round.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemorySessionStore,
  MirroringSessionStore,
} from '../src/sessions/store-adapter.js';
import { JsonlSessionStore } from '../src/sessions/store.js';
import {
  DEFAULT_TOOL_CLAIM_DETECTORS,
  MEMORY_WRITE_CLAIM_DETECTOR,
  auditToolClaims,
  isMemoryWriteRecord,
} from '../src/sessions/tool-claims.js';
import type { ToolClaimRecordView } from '../src/sessions/tool-claims.js';
import type { SessionKey, SessionStore as ExternalSessionStore, SessionStoreEntry } from '../src/types.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-kills-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tool-claims.ts
// ---------------------------------------------------------------------------

function rec(over: Partial<ToolClaimRecordView> = {}): ToolClaimRecordView {
  return {
    tool_name: 'memory',
    status: 'ok',
    tool_input: '{"command":"create","path":"/memories/a.md"}',
    ...over,
  } as ToolClaimRecordView;
}

describe('tool-claims: backing semantics (isMemoryWriteRecord)', () => {
  it('a successful memory WRITE backs; reads, failures and other tools do not', () => {
    expect(isMemoryWriteRecord(rec())).toBe(true);
    expect(isMemoryWriteRecord(rec({ tool_input: '{"command":"str_replace"}' }))).toBe(true);
    expect(isMemoryWriteRecord(rec({ tool_input: '{"command":"view"}' }))).toBe(false); // read, not write
    expect(isMemoryWriteRecord(rec({ status: 'error' }))).toBe(false);
    expect(isMemoryWriteRecord(rec({ tool_name: 'Write' }))).toBe(false);
  });
});

describe('tool-claims: audit findings', () => {
  const CLAIM_ZH = '第一段无关。\n已写入记忆，请放心。\n第三段也无关。';
  const CLAIM_EN = 'All done.\nI saved the plan to memory for next time.\nBye.';

  it('an UNBACKED zh claim is flagged with the exact claim line as snippet', () => {
    const findings = auditToolClaims({ assistantTexts: [CLAIM_ZH], toolCalls: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detectorId).toBe('memory-write-claim');
    expect(findings[0]!.messageIndex).toBe(0);
    expect(findings[0]!.snippet).toBe('已写入记忆，请放心。');
    expect(findings[0]!.reason).toContain('no backing call');
  });

  it('an UNBACKED en claim is flagged; a claim on the LAST line (no trailing newline) still extracts', () => {
    const f1 = auditToolClaims({ assistantTexts: [CLAIM_EN], toolCalls: [] });
    expect(f1).toHaveLength(1);
    expect(f1[0]!.snippet).toBe('I saved the plan to memory for next time.');

    const lastLine = 'preamble\nmemory updated';
    const f2 = auditToolClaims({ assistantTexts: [lastLine], toolCalls: [] });
    expect(f2).toHaveLength(1);
    expect(f2[0]!.snippet).toBe('memory updated');
  });

  it('a claim ANYWHERE in the session is silenced by ONE backing record (session-scoped)', () => {
    const findings = auditToolClaims({
      assistantTexts: ['无关回合', CLAIM_ZH],
      toolCalls: [rec()],
    });
    expect(findings).toHaveLength(0);
  });

  it('a failed or read-only memory record does NOT silence the claim', () => {
    expect(
      auditToolClaims({ assistantTexts: [CLAIM_ZH], toolCalls: [rec({ status: 'error' })] }),
    ).toHaveLength(1);
    expect(
      auditToolClaims({
        assistantTexts: [CLAIM_EN],
        toolCalls: [rec({ tool_input: '{"command":"view"}' })],
      }),
    ).toHaveLength(1);
  });

  it('uuid rides the finding for {uuid,text} entries and is absent for plain strings', () => {
    const withUuid = auditToolClaims({
      assistantTexts: [{ uuid: 'msg-7', text: CLAIM_ZH }],
      toolCalls: [],
    });
    expect(withUuid[0]!.messageUuid).toBe('msg-7');
    const plain = auditToolClaims({ assistantTexts: [CLAIM_ZH], toolCalls: [] });
    expect('messageUuid' in plain[0]!).toBe(false);
  });

  it('messageIndex points at the claiming text, and non-matching texts produce nothing', () => {
    const findings = auditToolClaims({
      assistantTexts: ['clean text', CLAIM_EN, 'also clean'],
      toolCalls: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.messageIndex).toBe(1);
  });

  it('a custom detector array REPLACES the default set', () => {
    const custom = {
      id: 'push-claim',
      claimPattern: /pushed to origin/i,
      backedBy: (r: ToolClaimRecordView) => r.tool_name === 'Bash' && r.status === 'ok',
    };
    // default detector would fire on the memory claim; custom set ignores it
    const findings = auditToolClaims({
      assistantTexts: ['已写入记忆。\nI pushed to origin already.'],
      toolCalls: [],
      detectors: [custom],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detectorId).toBe('push-claim');
  });

  it('representative detector phrases match (zh + en), and unrelated prose does not', () => {
    const positive = [
      '已记录',
      '记下来了',
      '已经保存到记忆',
      '记忆文件已更新',
      'I recorded the decision in memory.',
      "I've made a note of it.",
    ];
    for (const text of positive) {
      expect(MEMORY_WRITE_CLAIM_DETECTOR.claimPattern.test(text), text).toBe(true);
    }
    const negative = ['我读取了记忆文件。', 'memory usage is 200MB', 'the memories were touching'];
    for (const text of negative) {
      expect(MEMORY_WRITE_CLAIM_DETECTOR.claimPattern.test(text), text).toBe(false);
    }
    expect(DEFAULT_TOOL_CLAIM_DETECTORS).toContain(MEMORY_WRITE_CLAIM_DETECTOR);
  });
});

// ---------------------------------------------------------------------------
// store-adapter.ts
// ---------------------------------------------------------------------------

const PK = 'proj-A';
const key = (sessionId: string, subpath = ''): SessionKey => ({ projectKey: PK, sessionId, subpath });
const userEntry = (uuid: string): SessionStoreEntry =>
  ({ type: 'user', uuid, message: { role: 'user', content: 'hi' } }) as SessionStoreEntry;

describe('InMemorySessionStore: listSessions and delete semantics', () => {
  it('lists main transcripts only, newest mtime first, scoped to the project key', async () => {
    const mem = new InMemorySessionStore();
    await mem.append(key('old'), [userEntry('u1')]);
    await new Promise((r) => setTimeout(r, 3));
    await mem.append(key('new'), [userEntry('u2')]);
    await mem.append(key('new', 'sidechain.jsonl'), [userEntry('u3')]); // subpath: excluded
    await mem.append({ projectKey: 'other', sessionId: 'foreign', subpath: '' }, [userEntry('u4')]);

    const listed = await mem.listSessions(PK);
    expect(listed.map((e) => e.sessionId)).toEqual(['new', 'old']);
  });

  it('a later append refreshes the session mtime (latest write wins the ordering)', async () => {
    const mem = new InMemorySessionStore();
    await mem.append(key('a'), [userEntry('u1')]);
    await new Promise((r) => setTimeout(r, 3));
    await mem.append(key('b'), [userEntry('u2')]);
    await new Promise((r) => setTimeout(r, 3));
    await mem.append(key('a'), [userEntry('u3')]); // a becomes newest again
    const listed = await mem.listSessions(PK);
    expect(listed.map((e) => e.sessionId)).toEqual(['a', 'b']);
  });

  it('deleting the MAIN key wipes subpaths too; deleting a subpath leaves the main transcript', async () => {
    const mem = new InMemorySessionStore();
    await mem.append(key('s'), [userEntry('u1')]);
    await mem.append(key('s', 'side.jsonl'), [userEntry('u2')]);
    await mem.delete(key('s', 'side.jsonl'));
    expect(await mem.load(key('s'))).not.toBeNull();
    expect(await mem.load(key('s', 'side.jsonl'))).toBeNull();

    await mem.append(key('s', 'side.jsonl'), [userEntry('u3')]);
    await mem.delete(key('s'));
    expect(await mem.load(key('s'))).toBeNull();
    expect(await mem.load(key('s', 'side.jsonl'))).toBeNull();
  });
});

/** External store spy for the READ-side fallbacks. */
class ReadSpy implements ExternalSessionStore {
  listCalls = 0;
  loadCalls = 0;
  failList = false;
  failLoad = false;
  private readonly mem = new InMemorySessionStore();

  async append(k: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    await this.mem.append(k, entries);
  }
  async load(k: SessionKey): Promise<SessionStoreEntry[] | null> {
    this.loadCalls += 1;
    if (this.failLoad) throw new Error('load boom');
    return this.mem.load(k);
  }
  async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    this.listCalls += 1;
    if (this.failList) throw new Error('list boom');
    return this.mem.listSessions(projectKey);
  }
}

function makeMirror(spy: ExternalSessionStore): MirroringSessionStore {
  return new MirroringSessionStore(new JsonlSessionStore({ sessionDir: dir }), spy, {
    projectKey: PK,
    flush: 'eager',
    backoffBaseMs: 1,
  });
}

describe('MirroringSessionStore: read-side fallbacks (the sessionStore consumer surface)', () => {
  it('list(): an empty local store materializes sessions from the external store', async () => {
    const spy = new ReadSpy();
    await spy.append(key('remote-1'), [userEntry('u1')]);
    const mirror = makeMirror(spy);
    const listed = await mirror.list();
    expect(listed.map((s) => s.sessionId)).toEqual(['remote-1']);
    expect(spy.listCalls).toBe(1);
  });

  it('list(): a non-empty local store wins and the external store is NOT consulted', async () => {
    const spy = new ReadSpy();
    await spy.append(key('remote-1'), [userEntry('u1')]);
    const mirror = makeMirror(spy);
    mirror.append('local-1', userEntry('u2') as Record<string, unknown>);
    await mirror.flushAll();
    const listed = await mirror.list();
    expect(listed.map((s) => s.sessionId)).toEqual(['local-1']);
    expect(spy.listCalls).toBe(0);
  });

  it('list(): an external failure degrades to the (empty) local list instead of throwing', async () => {
    const spy = new ReadSpy();
    spy.failList = true;
    const mirror = makeMirror(spy);
    await expect(mirror.list()).resolves.toEqual([]);
  });

  it('list(): a store WITHOUT listSessions capability degrades to local', async () => {
    const bare: ExternalSessionStore = {
      append: async () => undefined,
      load: async () => null,
    };
    const mirror = makeMirror(bare);
    await expect(mirror.list()).resolves.toEqual([]);
  });

  it('latestSessionId(): picks the newest external session when local is empty; failure -> null', async () => {
    const spy = new ReadSpy();
    await spy.append(key('older'), [userEntry('u1')]);
    await new Promise((r) => setTimeout(r, 3));
    await spy.append(key('newest'), [userEntry('u2')]);
    const mirror = makeMirror(spy);
    expect(await mirror.latestSessionId()).toBe('newest');

    const failing = new ReadSpy();
    failing.failList = true;
    expect(await makeMirror(failing).latestSessionId()).toBeNull();
  });

  it('load(): an external load failure degrades to null instead of throwing', async () => {
    const spy = new ReadSpy();
    await spy.append(key('remote-1'), [userEntry('u1')]);
    spy.failLoad = true;
    const mirror = makeMirror(spy);
    expect(await mirror.load('remote-1')).toBeNull();
  });

  it('filePath(): forwards to a JsonlSessionStore local; undefined for InMemory locals', () => {
    const jsonlMirror = makeMirror(new ReadSpy());
    jsonlMirror.append('sess-x', userEntry('u1') as Record<string, unknown>);
    const p = jsonlMirror.filePath('sess-x');
    expect(typeof p).toBe('string');
    expect(p).toContain('sess-x');
  });
});

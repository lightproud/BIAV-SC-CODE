/**
 * Session persistence + resolution for query() (extracted from query.ts,
 * audit 2026-07-10 P2-3B).
 *
 * The write side: message/assistant appends, and the SM-乙b §5.2 write-ahead
 * checkpoint pair (pending_turn opens a request segment, turn_complete
 * settles it — a dangling pending is crash evidence a resume re-drives).
 * The read side: session resolution (resume / continue-latest / fork /
 * explicit sessionId / fresh), carrying the dangling-checkpoint evidence
 * into the run. Bound once per query via createSessionPersistence.
 */

import { randomUUID } from 'node:crypto';

import type { APIMessageParam, ContentBlock, Options } from '../types.js';
import type { SessionStore } from '../internal/contracts.js';

/** Extra fields the concrete JSONL store surfaces on a loaded session beyond the
 *  internal StoredSession contract. Read structurally (not via the store type)
 *  so a query-resume fork can copy them without coupling to the concrete store
 *  (audit r4 V3-1): the standalone forkSession() copies EVERY raw entry, so
 *  dropping tool_call telemetry and the title/tag here diverged the two forks —
 *  getSessionToolCalls(fork) returned [] and the fork lost its title. */
type ForkCopyExtras = {
  customTitle?: string;
  tag?: string;
  toolCallRecords?: Array<Record<string, unknown>>;
};

export type ResolvedSession = {
  sessionId: string;
  history: APIMessageParam[];
  resumed: boolean;
  /** True when the meta line still needs to be written on first persist. */
  needMeta: boolean;
  /**
   * SM-乙b §5.2: the resumed transcript carries a dangling pending_turn
   * (crash inside the request segment). When the replayed history also ends
   * with a user turn, run() re-drives exactly that API request segment before
   * consuming new input — tools are NEVER replayed (their execution state is
   * whatever tool_result records reached disk).
   */
  redrivePending?: boolean;
  /** uuid of the dangling pending_turn record (settled after the re-drive). */
  pendingTurnUuid?: string;
  /** turn_ref of the dangling pending_turn (the interrupted user turn uuid). */
  pendingTurnRef?: string;
};

export type SessionPersistenceConfig = {
  store: SessionStore;
  /** False -> every write helper is a no-op (persistSession: false). */
  persist: boolean;
  options: Pick<Options, 'resume' | 'continue' | 'forkSession' | 'sessionId'>;
  cwd: string;
  /** Git branch recorded on a fork's meta line, when probed. */
  sessionGitBranch: string | undefined;
  debug: (msg: string) => void;
};

export type SessionPersistence = {
  persistParam(sessionId: string, m: APIMessageParam, uuid?: string): void;
  persistAssistant(sessionId: string, content: ContentBlock[], uuid?: string): void;
  persistPendingTurn(sessionId: string, pendingUuid: string, turnRef: string): void;
  persistTurnComplete(sessionId: string, pendingUuid: string): void;
  resolveSession(): Promise<ResolvedSession>;
};

export function createSessionPersistence(
  cfg: SessionPersistenceConfig,
): SessionPersistence {
  const { store, persist, options, cwd, sessionGitBranch, debug } = cfg;

  function persistParam(sessionId: string, m: APIMessageParam, uuid?: string): void {
    if (!persist) return;
    // Mirror persistAssistant's empty guard (audit 2026-07-17 L53): an empty
    // turn ('' or []) persisted here survives every repair pass and 400s the
    // API on each later resume replay.
    // WV3-4 (audit r3): a length check alone let `[{type:'text',text:''}]`
    // (array length 1, empty text) through — the API 400s on that too. Filter
    // empty text blocks first, exactly as persistAssistant does.
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content.filter((b) => (b.type === 'text' ? b.text.length > 0 : true));
    if (content.length === 0) return;
    store.append(sessionId, {
      type: m.role,
      // Persist a STABLE message identity (keeper ruling 2026-07-13): when the
      // caller already minted a uuid for the streamed SDKMessage, the record
      // carries THAT uuid, so the stream view and every later
      // getSessionMessages read agree. Records written before this ruling
      // carry none - the read path mints a fallback for those (legacy
      // tolerance), which is why the field stays optional there.
      uuid: uuid ?? randomUUID(),
      timestamp: new Date().toISOString(),
      message: { role: m.role, content },
    });
  }

  /**
   * Persist an assistant turn AT YIELD TIME (finding #34). The engine pushes
   * the assistant to its in-memory history only after yielding it, so a
   * consumer that breaks right after the assistant message would otherwise lose
   * the answer from disk. Empty text blocks are dropped and an all-empty
   * message is skipped, so the persisted transcript never carries a
   * {role:'assistant',content:[]} turn the API would 400 on resume.
   */
  function persistAssistant(sessionId: string, content: ContentBlock[], uuid?: string): void {
    if (!persist) return;
    const filtered = content.filter((b) =>
      b.type === 'text' ? b.text.length > 0 : true,
    );
    if (filtered.length === 0) return;
    store.append(sessionId, {
      type: 'assistant',
      uuid: uuid ?? randomUUID(),
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: filtered },
    });
  }

  /**
   * §5.2 write-ahead checkpoint: mark that a turn is entering its API request
   * segment. A crash before the matching turn_complete leaves this record
   * dangling, which a later resume reads as "the interruption happened in the
   * request segment — re-drive it". turn_ref references the already-persisted
   * user turn's uuid (no content copied). Always on when the query persists:
   * the record is tiny and it is what makes the crash point diagnosable.
   */
  function persistPendingTurn(
    sessionId: string,
    pendingUuid: string,
    turnRef: string,
  ): void {
    if (!persist) return;
    store.append(sessionId, {
      type: 'pending_turn',
      uuid: pendingUuid,
      timestamp: new Date().toISOString(),
      turn_ref: turnRef,
    });
  }

  /** §5.2: settle a pending_turn (append-only — the pending line stays, the
   *  pairing makes it logically closed). */
  function persistTurnComplete(sessionId: string, pendingUuid: string): void {
    if (!persist) return;
    store.append(sessionId, {
      type: 'turn_complete',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      pending_uuid: pendingUuid,
    });
  }

  /**
   * Session resolution:
   *   - resume / continue-latest -> load and replay the prior transcript (the
   *     explicit resume path). forkSession copies it under a fresh id.
   *   - sessionId (without resume/continue) -> select/create THAT id but start
   *     with EMPTY history: it labels a logically fresh session, it does not
   *     auto-resume prior content (finding #38). resume stays the only resume.
   *   - nothing -> a fresh randomUUID.
   */
  async function resolveSession(): Promise<ResolvedSession> {
    // Explicit resume source: options.resume, or continue:true -> latest.
    let resumeSource: string | undefined = options.resume;
    if (resumeSource === undefined && options.continue === true) {
      resumeSource = (await store.latestSessionId()) ?? undefined;
    }

    if (resumeSource !== undefined) {
      const stored = await store.load(resumeSource);
      if (stored !== null) {
        // §5.2: carry the dangling-checkpoint evidence into the run so the
        // interrupted request segment is re-driven before new input.
        const pendingFields = {
          ...(stored.pendingTurnInterrupted === true ? { redrivePending: true } : {}),
          ...(stored.pendingTurnUuid !== undefined
            ? { pendingTurnUuid: stored.pendingTurnUuid }
            : {}),
          ...(stored.pendingTurnRef !== undefined
            ? { pendingTurnRef: stored.pendingTurnRef }
            : {}),
        };
        if (options.forkSession === true) {
          // Copy the transcript under a new id; the original stays untouched.
          // The fork's future turns run under the CURRENT query's cwd, so the
          // fork meta records `cwd`, not the source session's cwd (finding #39).
          const newId = randomUUID();
          const forkExtras = stored as ForkCopyExtras;
          if (persist) {
            store.append(newId, {
              type: 'meta',
              sessionId: newId,
              createdAt: Date.now(),
              cwd,
              firstPrompt: stored.firstPrompt,
              ...(sessionGitBranch !== undefined ? { gitBranch: sessionGitBranch } : {}),
            });
            for (const m of stored.messages) {
              // Fork copies mint FRESH identities (fork semantics - new ids,
              // consistently new): the source ids are not carried over.
              store.append(newId, {
                type: m.role,
                uuid: randomUUID(),
                timestamp: new Date().toISOString(),
                message: m,
              });
            }
            // Copy the source's R1 accounting records too: dropping them made
            // getSessionAccounting on the fork report zero cumulative cost,
            // contradicting standalone forkSession which copies every entry
            // (audit 2026-07-17 L51). Fresh uuids, fork's session id.
            for (const rec of stored.accountingRecords ?? []) {
              store.append(newId, {
                ...rec,
                uuid: randomUUID(),
                session_id: newId,
              });
            }
            // audit r4 V3-1: copy the S3 tool_call telemetry AND re-emit the
            // title/tag, matching standalone forkSession() which copies every
            // raw entry. Without this getSessionToolCalls(fork) returned [] and
            // the fork lost its title (customTitle/tag live on meta_update
            // records, which the selective copy above never carried).
            for (const rec of forkExtras.toolCallRecords ?? []) {
              store.append(newId, {
                ...rec,
                uuid: randomUUID(),
                session_id: newId,
              });
            }
            if (forkExtras.customTitle !== undefined || forkExtras.tag !== undefined) {
              store.append(newId, {
                type: 'meta_update',
                uuid: randomUUID(),
                ...(forkExtras.customTitle !== undefined
                  ? { customTitle: forkExtras.customTitle }
                  : {}),
                ...(forkExtras.tag !== undefined ? { tag: forkExtras.tag } : {}),
              });
            }
          }
          return {
            sessionId: newId,
            history: [...stored.messages],
            resumed: true,
            needMeta: false,
          };
        }
        return {
          sessionId: resumeSource,
          history: [...stored.messages],
          resumed: true,
          needMeta: false,
          // §5.2: a dangling pending_turn on the resumed transcript arms the
          // redrive-on-resume in run() (fork deliberately omits this — a fork
          // is a clean copy under a fresh id, not a crash recovery).
          ...pendingFields,
        };
      }
      // Resume target has no stored transcript.
      if (options.forkSession === true) {
        // Fork ALWAYS mints a fresh id; never write into the (missing) source
        // id, which a later real session under that id would collide with
        // (finding #39).
        return { sessionId: randomUUID(), history: [], resumed: false, needMeta: true };
      }
      debug(
        `resume: no stored transcript for session ${resumeSource}; starting fresh under that id`,
      );
      return { sessionId: resumeSource, history: [], resumed: false, needMeta: true };
    }

    // A specific sessionId (no resume/continue) selects that id WITHOUT
    // resuming prior content: fresh history, but reuse the existing meta line
    // if a transcript already lives under that id (finding #38).
    if (options.sessionId !== undefined) {
      const existing = persist ? await store.load(options.sessionId) : null;
      return {
        sessionId: options.sessionId,
        history: [],
        resumed: false,
        needMeta: existing === null,
      };
    }

    return { sessionId: randomUUID(), history: [], resumed: false, needMeta: true };
  }

  return {
    persistParam,
    persistAssistant,
    persistPendingTurn,
    persistTurnComplete,
    resolveSession,
  };
}

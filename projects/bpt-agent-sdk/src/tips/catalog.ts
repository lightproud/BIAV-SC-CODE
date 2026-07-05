/**
 * Context-tip situation catalog — the registry the context-tip selector matches
 * a transcript against. Each entry is a faithful OPEN reproduction of an
 * archived `data-context-tip-situation-*` file (the situation text is verbatim);
 * feature_id / action / description are the entry's routing metadata.
 *
 * The catalog is EXTENSIBLE: a host registers its own situations via
 * selectContextTip's options, so this ships the archived seed situations while
 * letting a consumer grow the catalog. Corpus-sync (tests/tips.test.ts) holds
 * each seed situation's text to its archived source.
 */

/** One tip situation the selector can match against. */
export interface ContextTipSituation {
  /** Stable id the selector returns as feature_id. */
  featureId: string;
  /** The command / shortcut the tip suggests trying. */
  action: string;
  /** Verbatim situation text from the archive (the match pattern). */
  situation: string;
  /** Archive slug this situation reproduces (for provenance), if any. */
  slug?: string;
}

/**
 * Situation text — verbatim body of
 * data-context-tip-situation-manual-polling. Fires the /loop tip.
 */
export const SITUATION_MANUAL_POLLING = `User has asked Claude to check the same status multiple times across recent turns — "is the deploy done?", "check CI again", "any update on the build?", "check once more". They are manually polling. Also matches when the user says "keep checking until X" or "check every few minutes" and Claude ran the check just once — Claude cannot poll on its own without /loop. IMPORTANT: Do NOT match a single status check, or checks Claude runs as part of a larger task it is driving (e.g., running tests while implementing a feature).`;

/**
 * Situation text — verbatim body of
 * data-context-tip-situation-persistent-memory. Fires the memory tip.
 */
export const SITUATION_PERSISTENT_MEMORY = `User restates a fact or preference about their project or setup that they have told Claude before — "as I mentioned", "like I said", "remember I use X", "I keep telling you" — or explicitly asks Claude to remember something for future sessions. They are trying to establish persistent context via conversation. IMPORTANT: Do NOT match tone/verbosity preferences (that is verbose-preference), per-tool-event rules (that is hooks-automation), or wanting to resume prior-session work (that is previous-session-reference).`;

/** The archived seed situations (a host may extend this at call time). */
export const CONTEXT_TIP_CATALOG: readonly ContextTipSituation[] = [
  {
    featureId: 'manual-polling',
    action: '/loop',
    situation: SITUATION_MANUAL_POLLING,
    slug: 'data-context-tip-situation-manual-polling',
  },
  {
    featureId: 'persistent-memory',
    action: '# to remember',
    situation: SITUATION_PERSISTENT_MEMORY,
    slug: 'data-context-tip-situation-persistent-memory',
  },
];

/**
 * Render a catalog into the `<situations>` block the selector prompt expects
 * (mirrors the official FORMAT_CONTEXT_TIP_SITUATIONS_FN): one block per
 * situation, id + action + situation text.
 */
export function renderCatalog(catalog: readonly ContextTipSituation[]): string {
  return catalog
    .map(
      (s) =>
        `- feature_id: ${s.featureId}\n  action: ${s.action}\n  situation: ${s.situation}`,
    )
    .join('\n');
}

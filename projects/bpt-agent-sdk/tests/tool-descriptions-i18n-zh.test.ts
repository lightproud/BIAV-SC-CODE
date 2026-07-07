/**
 * i18n-zh structural guard (keeper ruling B, 2026-07-08): the built-in tool
 * descriptions are translated to Chinese in-place and shipped on the wire. This
 * replaces the English corpus-sync guard for TRANSLATED tools — there is no
 * longer an English official source to be faithful to, so instead we assert the
 * translation is well-formed: it is actually Chinese, carries no emoji
 * (CLAUDE.md §2.4), and preserves the English wire tokens a translation must NOT
 * localize (tool names + parameter names are identifiers, not prose).
 */

import { describe, expect, it } from 'vitest';

import {
  READ_DESCRIPTION,
  EDIT_DESCRIPTION,
  WRITE_DESCRIPTION,
  GREP_DESCRIPTION,
  GLOB_DESCRIPTION,
} from '../src/tools/descriptions.js';

// Any CJK ideograph -> the description is actually Chinese.
const CJK = /[一-鿿]/;
// Pictographic emoji / dingbats / flags / variation selector. Deliberately does
// NOT overlap CJK (4E00-9FFF) or full-width Chinese punctuation (3000-303F,
// FF00-FFEF), so legitimate Chinese text never trips it.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

// [displayName, description, wire tokens that MUST survive translation]
const TRANSLATED: Array<[string, string, string[]]> = [
  ['Read', READ_DESCRIPTION, ['file_path', 'offset', 'limit', 'cat -n', 'PDF', '.ipynb', 'Bash']],
  ['Edit', EDIT_DESCRIPTION, ['old_string', 'new_string', 'replace_all', 'Read', 'emoji']],
  ['Write', WRITE_DESCRIPTION, ['Edit', 'Read', 'README', 'emoji']],
  [
    'Grep',
    GREP_DESCRIPTION,
    ['ripgrep', 'glob', 'type', 'multiline', 'content', 'files_with_matches', 'count'],
  ],
  ['Glob', GLOB_DESCRIPTION, ['glob', '**/*.js', 'src/**/*.ts']],
];

describe('tool descriptions i18n-zh (batch 1: Read/Edit/Write/Grep/Glob)', () => {
  it.each(TRANSLATED)(
    '%s description is non-empty Chinese, emoji-free, and keeps its wire tokens',
    (name, desc, tokens) => {
      expect(desc.length).toBeGreaterThan(0);
      expect(CJK.test(desc), `${name} description must be Chinese`).toBe(true);
      expect(EMOJI.test(desc), `${name} description must carry no emoji`).toBe(false);
      for (const t of tokens) {
        expect(desc.includes(t), `${name} description must preserve wire token "${t}"`).toBe(
          true,
        );
      }
    },
  );
});

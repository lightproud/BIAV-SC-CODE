/**
 * Module C (fs tools) test suite: Read / Write / Edit built-in tools.
 *
 * Contract under test: docs/ARCHITECTURE.md section C + src/internal/contracts.ts
 * (BuiltinTool / ToolContext / ToolResultPayload). All filesystem work happens
 * in mkdtemp sandboxes that are removed after every test.
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTool } from '../src/tools/read.js';
import { writeTool } from '../src/tools/write.js';
import { editTool } from '../src/tools/edit.js';
import {
  FileCheckpointStore,
  makeCheckpointRecorder,
} from '../src/sessions/checkpoints.js';
import { AbortError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';

/** Sandboxes created during the current test; removed in afterEach. */
let sandboxes: string[] = [];

async function makeSandbox(prefix = 'bpt-fs-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  sandboxes.push(dir);
  return dir;
}

function makeCtx(cwd: string, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...extra,
  };
}

function abortedCtx(cwd: string): ToolContext {
  const ac = new AbortController();
  ac.abort();
  return makeCtx(cwd, { signal: ac.signal });
}

/** cat -n style line: right-aligned 6-char number, tab, text. */
function catLine(n: number, text: string): string {
  return `${String(n).padStart(6)}\t${text}`;
}

let sandbox: string;

beforeEach(async () => {
  sandboxes = [];
  sandbox = await makeSandbox();
});

afterEach(async () => {
  await Promise.all(
    sandboxes.map((d) => rm(d, { recursive: true, force: true })),
  );
  sandboxes = [];
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

describe('Read tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(readTool.name).toBe('Read');
    expect(readTool.readOnly).toBe(true);
    expect(readTool.inputSchema.required).toContain('file_path');
  });

  it('formats a normal file in exact cat -n style (6-char right-aligned number + tab)', async () => {
    const file = path.join(sandbox, 'plain.txt');
    await writeFile(file, 'aa\nbb\ncc\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe(
      [catLine(1, 'aa'), catLine(2, 'bb'), catLine(3, 'cc')].join('\n'),
    );
  });

  it('resolves relative paths against ctx.cwd', async () => {
    await mkdir(path.join(sandbox, 'sub'), { recursive: true });
    await writeFile(path.join(sandbox, 'sub', 'rel.txt'), 'hello\n', 'utf8');

    const res = await readTool.execute(
      { file_path: 'sub/rel.txt' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe(catLine(1, 'hello'));
  });

  it('honors 1-based offset and limit, and appends a continuation hint', async () => {
    const file = path.join(sandbox, 'five.txt');
    await writeFile(file, 'L1\nL2\nL3\nL4\nL5\n', 'utf8');

    const res = await readTool.execute(
      { file_path: file, offset: 2, limit: 2 },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(2, 'L2'));
    expect(content).toContain(catLine(3, 'L3'));
    expect(content).not.toContain('L1');
    expect(content).not.toContain('L4');
    // Continuation hint names the shown window, the total, and the next offset.
    expect(content).toMatch(/lines 2-3 of 5/);
    expect(content).toMatch(/offset=4/);
  });

  it('clamps zero/negative offsets to line 1', async () => {
    const file = path.join(sandbox, 'clamp.txt');
    await writeFile(file, 'one\ntwo\n', 'utf8');

    for (const offset of [0, -7]) {
      const res = await readTool.execute(
        { file_path: file, offset },
        makeCtx(sandbox),
      );
      expect(res.isError).toBeFalsy();
      expect(res.content).toBe([catLine(1, 'one'), catLine(2, 'two')].join('\n'));
    }
  });

  it('returns isError with the total line count when offset is past EOF', async () => {
    const file = path.join(sandbox, 'small.txt');
    await writeFile(file, 'a\nb\nc\nd\ne\n', 'utf8');

    const res = await readTool.execute(
      { file_path: file, offset: 6 },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/5 lines/);
  });

  it('caps output at 2000 lines by default with a truncation hint', async () => {
    const total = 2005;
    const body = Array.from({ length: total }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
    const file = path.join(sandbox, 'big.txt');
    await writeFile(file, body, 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(1, 'line-1'));
    expect(content).toContain(catLine(2000, 'line-2000'));
    expect(content).not.toContain('line-2001');
    expect(content).toMatch(/lines 1-2000 of 2005/);
    expect(content).toMatch(/offset=2001/);
  });

  it('returns a system-reminder-style note (not an error) for an empty file', async () => {
    const file = path.join(sandbox, 'empty.txt');
    await writeFile(file, '', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toMatch(/<system-reminder>.*empty.*<\/system-reminder>/s);
  });

  it('returns isError for a missing file', async () => {
    const res = await readTool.execute(
      { file_path: path.join(sandbox, 'no-such-file.txt') },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/does not exist/i);
  });

  it('returns isError for a directory target', async () => {
    const dir = path.join(sandbox, 'a-directory');
    await mkdir(dir);

    const res = await readTool.execute({ file_path: dir }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/directory/i);
  });

  it('returns isError for a binary file (NUL bytes)', async () => {
    const file = path.join(sandbox, 'blob.bin');
    await writeFile(file, Buffer.from([0x62, 0x00, 0x01, 0xff, 0x00]));

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/binary/i);
  });

  it('truncates individual lines at 2000 characters', async () => {
    const long = 'x'.repeat(2500);
    const file = path.join(sandbox, 'long-line.txt');
    await writeFile(file, `${long}\nshort\n`, 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(1, 'x'.repeat(2000)));
    expect(content).not.toContain('x'.repeat(2001));
    expect(content).toContain(catLine(2, 'short'));
  });

  it('strips CR from CRLF line endings', async () => {
    const file = path.join(sandbox, 'crlf.txt');
    await writeFile(file, 'first\r\nsecond\r\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe([catLine(1, 'first'), catLine(2, 'second')].join('\n'));
    expect(String(res.content)).not.toContain('\r');
  });

  // Regression (finding #11, P2): Read must refuse an oversized file instead of
  // buffering it whole into memory (OOM). A text-looking file that slips past
  // the 8KB binary sniff must be rejected by the byte-size guard.
  it('rejects a file larger than the byte cap instead of OOMing', async () => {
    const file = path.join(sandbox, 'huge.log');
    // 51MB of ASCII 'a' (no NUL, so it passes the binary sniff) exceeds the
    // 50MB Read cap.
    await writeFile(file, Buffer.alloc(51 * 1024 * 1024, 0x61));

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    const content = String(res.content);
    expect(content).toMatch(/read cap/i);
    expect(content).toMatch(/Grep/);
  });

  it('still reads a normal small file after the byte-cap guard', async () => {
    const file = path.join(sandbox, 'normal.txt');
    await writeFile(file, 'x\ny\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe([catLine(1, 'x'), catLine(2, 'y')].join('\n'));
  });

  // --- image support (task #17) ------------------------------------------

  const IMAGE_CASES: Array<[string, string, Buffer]> = [
    ['png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    ['jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6])],
    ['gif', 'image/gif', Buffer.from('GIF89a-payload', 'latin1')],
    [
      'webp',
      'image/webp',
      Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('WEBP', 'latin1'),
        Buffer.from([7, 8]),
      ]),
    ],
  ];

  for (const [ext, media, bytes] of IMAGE_CASES) {
    it(`returns an image content block for a ${ext} file`, async () => {
      const file = path.join(sandbox, `pic.${ext}`);
      await writeFile(file, bytes);

      const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

      expect(res.isError).toBeFalsy();
      expect(Array.isArray(res.content)).toBe(true);
      const blocks = res.content as Array<{
        type: string;
        source: { type: string; media_type: string; data: string };
      }>;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('image');
      expect(blocks[0]!.source.type).toBe('base64');
      expect(blocks[0]!.source.media_type).toBe(media);
      expect(blocks[0]!.source.data).toBe(bytes.toString('base64'));
    });
  }

  it('detects an image by content even under a mislabeled .txt extension', async () => {
    const file = path.join(sandbox, 'actually-a-png.txt');
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]));

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    const blocks = res.content as Array<{ type: string; source: { media_type: string } }>;
    expect(blocks[0]!.type).toBe('image');
    expect(blocks[0]!.source.media_type).toBe('image/png');
  });

  it('returns a base64 document block for a PDF file', async () => {
    const file = path.join(sandbox, 'doc.pdf');
    const bytes = Buffer.from('%PDF-1.7\n%binary\n', 'latin1');
    await writeFile(file, bytes);

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(Array.isArray(res.content)).toBe(true);
    const blocks = res.content as Array<{
      type: string;
      source: { type: string; media_type: string; data: string };
    }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('document');
    expect(blocks[0]!.source.type).toBe('base64');
    expect(blocks[0]!.source.media_type).toBe('application/pdf');
    expect(blocks[0]!.source.data).toBe(bytes.toString('base64'));
  });

  // E7-02: the `pages` param (official parity). Behavior-honesty pins: page
  // slicing is NOT shipped, so PDF+pages fails explicitly (never silently
  // returns the whole document) and non-PDF+pages fails as inapplicable.
  describe('pages parameter (E7-02)', () => {
    const writePdf = async (): Promise<string> => {
      const file = path.join(sandbox, 'doc.pdf');
      await writeFile(file, Buffer.from('%PDF-1.7\n%binary\n', 'latin1'));
      return file;
    };

    it('is declared in the input schema (required set unchanged)', () => {
      const props = readTool.inputSchema.properties ?? {};
      expect(Object.keys(props).sort()).toEqual([
        'file_path',
        'limit',
        'offset',
        'pages',
      ]);
      expect(readTool.inputSchema.required).toEqual(['file_path']);
    });

    it('rejects a non-string pages value', async () => {
      const file = await writePdf();
      const res = await readTool.execute(
        { file_path: file, pages: 5 },
        makeCtx(sandbox),
      );
      expect(res.isError).toBe(true);
      expect(res.content).toContain('"pages" must be a string');
    });

    it('rejects malformed / descending / zero-based ranges', async () => {
      const file = await writePdf();
      for (const pages of ['abc', '1-2-3', '5-3', '0', '0-4', '']) {
        const res = await readTool.execute(
          { file_path: file, pages },
          makeCtx(sandbox),
        );
        expect(res.isError, `pages="${pages}"`).toBe(true);
      }
    });

    it('rejects a range wider than 20 pages (official cap)', async () => {
      const file = await writePdf();
      const res = await readTool.execute(
        { file_path: file, pages: '1-21' },
        makeCtx(sandbox),
      );
      expect(res.isError).toBe(true);
      expect(res.content).toContain('maximum 20 pages');
    });

    it('rejects pages on a non-PDF file with an explicit inapplicability error', async () => {
      const file = path.join(sandbox, 'plain.txt');
      await writeFile(file, 'one\ntwo\n');
      const res = await readTool.execute(
        { file_path: file, pages: '1-2' },
        makeCtx(sandbox),
      );
      expect(res.isError).toBe(true);
      expect(res.content).toContain('only applies to PDF files');
    });

    it('rejects pages on a PDF (slicing not shipped) instead of silently returning the whole document', async () => {
      const file = await writePdf();
      const res = await readTool.execute(
        { file_path: file, pages: '1-5' },
        makeCtx(sandbox),
      );
      expect(res.isError).toBe(true);
      expect(res.content).toContain('page-range reads are not supported');
      // The honest recovery path is spelled out.
      expect(res.content).toContain('Retry without "pages"');
    });

    it('a PDF read WITHOUT pages still returns the whole document block', async () => {
      const file = await writePdf();
      const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));
      expect(res.isError).toBeFalsy();
      const blocks = res.content as Array<{ type: string }>;
      expect(blocks[0]!.type).toBe('document');
    });
  });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

describe('Write tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(writeTool.name).toBe('Write');
    expect(writeTool.readOnly).toBe(false);
    expect(writeTool.isFileEdit).toBe(true);
  });

  it('creates a new file, mkdir -p style, and reports creation with a byte count', async () => {
    const rel = path.join('deep', 'nested', 'dir', 'new.txt');

    const res = await writeTool.execute(
      { file_path: rel, content: 'hello' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/creat/i);
    expect(content).toContain('5 bytes');
    const onDisk = await readFile(path.join(sandbox, rel), 'utf8');
    expect(onDisk).toBe('hello');
  });

  it('reports overwrite (not creation) on an existing file, with a UTF-8 byte count', async () => {
    const file = path.join(sandbox, 'exists.txt');
    await writeFile(file, 'old', 'utf8');

    const res = await writeTool.execute(
      { file_path: file, content: 'héllo' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/overw/i);
    expect(content).not.toMatch(/creat/i);
    // 'héllo' is 6 bytes in UTF-8, not 5 characters.
    expect(content).toContain('6 bytes');
    expect(await readFile(file, 'utf8')).toBe('héllo');
  });

  it('returns isError when the target is a directory', async () => {
    const dir = path.join(sandbox, 'target-dir');
    await mkdir(dir);

    const res = await writeTool.execute(
      { file_path: dir, content: 'nope' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/directory/i);
    // Directory must be left intact.
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  // -- finding 9: lossless checkpoint pre-image capture ----------------------

  it('does not record a lossy UTF-8 pre-image when overwriting a binary file (finding 9)', async () => {
    const file = path.join(sandbox, 'image.bin');
    // Bytes that are NOT valid UTF-8 -> reading as 'utf8' would mangle them.
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01]);
    await writeFile(file, original);

    const calls: Array<{ abs: string; preImage: string | null }> = [];
    const ctx = makeCtx(sandbox, {
      recordFileChange: (abs, preImage) => calls.push({ abs, preImage }),
    });

    const res = await writeTool.execute({ file_path: file, content: 'new text' }, ctx);
    expect(res.isError).toBeFalsy();
    // A binary/non-UTF-8 pre-image cannot round-trip through the UTF-8 blob
    // pipeline, so it must NOT be recorded (recording mojibake would corrupt
    // the file on rewind). Before the fix this recorded a U+FFFD-mangled string.
    expect(calls).toEqual([]);
  });

  it('records the exact text pre-image for a UTF-8 file (finding 9)', async () => {
    const file = path.join(sandbox, 'notes.txt');
    const original = 'héllo 世界\nline2';
    await writeFile(file, original, 'utf8');

    const calls: Array<{ abs: string; preImage: string | null }> = [];
    const ctx = makeCtx(sandbox, {
      recordFileChange: (abs, preImage) => calls.push({ abs, preImage }),
    });

    await writeTool.execute({ file_path: file, content: 'REPLACED' }, ctx);
    expect(calls).toEqual([{ abs: file, preImage: original }]);
  });

  it('records null (create) for a brand-new file (finding 9)', async () => {
    const file = path.join(sandbox, 'fresh.txt');
    const calls: Array<{ abs: string; preImage: string | null }> = [];
    const ctx = makeCtx(sandbox, {
      recordFileChange: (abs, preImage) => calls.push({ abs, preImage }),
    });
    await writeTool.execute({ file_path: file, content: 'x' }, ctx);
    expect(calls).toEqual([{ abs: file, preImage: null }]);
  });

  it('rewind restores a text file exactly and never corrupts a binary file (finding 9)', async () => {
    const ckptDir = await mkdtemp(path.join(os.tmpdir(), 'bpt-ckpt-'));
    try {
      const store = new FileCheckpointStore({ sessionDir: ckptDir });
      store.bind('sess-1');
      const turn = 'user-msg-1';
      store.beginTurn(turn);
      const ctx = makeCtx(sandbox, { recordFileChange: makeCheckpointRecorder(store) });

      // Text with multibyte UTF-8 -> must round-trip byte-exact through rewind.
      const textFile = path.join(sandbox, 'doc.txt');
      const originalText = 'héllo 世界\nsecond';
      await writeFile(textFile, originalText, 'utf8');

      // Binary/non-UTF-8 -> pre-image is not capturable losslessly, so it must
      // be left untouched by rewind (not restored to mojibake, not deleted).
      const binFile = path.join(sandbox, 'blob.bin');
      await writeFile(binFile, Buffer.from([0x00, 0xff, 0xfe, 0x89, 0x50]));

      await writeTool.execute({ file_path: textFile, content: 'REPLACED' }, ctx);
      await writeTool.execute({ file_path: binFile, content: 'REPLACED' }, ctx);

      const result = await store.rewind(turn);

      // Text restored to the exact original bytes.
      expect(await readFile(textFile, 'utf8')).toBe(originalText);
      expect(result.restoredFiles).toContain(textFile);

      // Binary was never checkpointed -> not in the rewind plan -> the written
      // content stays; before the fix rewind wrote a U+FFFD string back.
      expect(result.restoredFiles).not.toContain(binFile);
      expect(result.deletedFiles).not.toContain(binFile);
      expect(await readFile(binFile, 'utf8')).toBe('REPLACED');
    } finally {
      await rm(ckptDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

describe('Edit tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(editTool.name).toBe('Edit');
    expect(editTool.readOnly).toBe(false);
    expect(editTool.isFileEdit).toBe(true);
  });

  it('performs a single unique replacement, reporting count and a cat -n context snippet', async () => {
    const file = path.join(sandbox, 'edit-one.txt');
    await writeFile(file, 'line1\nline2\nold line3\nline4\nline5\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'old line3', new_string: 'new line3' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/1 occurrence\b/);
    // Snippet shows the edit site in cat -n format.
    expect(content).toContain(catLine(3, 'new line3'));
    expect(await readFile(file, 'utf8')).toBe(
      'line1\nline2\nnew line3\nline4\nline5\n',
    );
  });

  it('replaces every occurrence with replace_all and reports the multi count', async () => {
    const file = path.join(sandbox, 'edit-all.txt');
    await writeFile(file, 'foo a\nfoo b\nfoo c\n', 'utf8');

    const res = await editTool.execute(
      {
        file_path: file,
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toMatch(/3 occurrences/);
    expect(await readFile(file, 'utf8')).toBe('bar a\nbar b\nbar c\n');
  });

  it('returns isError when old_string === new_string', async () => {
    const file = path.join(sandbox, 'same.txt');
    await writeFile(file, 'anything\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'anything', new_string: 'anything' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    // File must be untouched.
    expect(await readFile(file, 'utf8')).toBe('anything\n');
  });

  it('returns isError when old_string is not found', async () => {
    const file = path.join(sandbox, 'notfound.txt');
    await writeFile(file, 'alpha beta\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'gamma', new_string: 'delta' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/not found/i);
    expect(await readFile(file, 'utf8')).toBe('alpha beta\n');
  });

  it('returns isError naming the count for an ambiguous match without replace_all', async () => {
    const file = path.join(sandbox, 'ambiguous.txt');
    await writeFile(file, 'dup here\ndup there\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'dup', new_string: 'uniq' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/2 occurrences/);
    expect(await readFile(file, 'utf8')).toBe('dup here\ndup there\n');
  });

  it('returns isError for an empty old_string', async () => {
    const file = path.join(sandbox, 'emptyold.txt');
    await writeFile(file, 'content\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: '', new_string: 'x' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('content\n');
  });

  it('returns isError for a binary target', async () => {
    const file = path.join(sandbox, 'edit.bin');
    await writeFile(file, Buffer.from([0x41, 0x00, 0x42]));

    const res = await editTool.execute(
      { file_path: file, old_string: 'A', new_string: 'B' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/binary/i);
  });

  it('returns isError for a missing file', async () => {
    const res = await editTool.execute(
      {
        file_path: path.join(sandbox, 'ghost.txt'),
        old_string: 'a',
        new_string: 'b',
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/does not exist/i);
  });
});

// ---------------------------------------------------------------------------
// No path fence (official-aligned; keeper ruling on BPT report #2, 2026-07-05)
// Read/Write/Edit reach any path the process can; the permission gate - not a
// filesystem fence - is the access control (the v0.1 cwd fence was removed:
// BPT-specific, inconsistent with Grep/Glob/Bash, and never a real boundary
// with Bash present). additionalDirectories keeps its sandbox-writablePaths role.
// ---------------------------------------------------------------------------

describe('no path fence (official-aligned)', () => {
  it('reads a file OUTSIDE cwd (was denied under the old fence)', async () => {
    const outside = await makeSandbox('bpt-fs-outside-');
    const target = path.join(outside, 'secret.txt');
    await writeFile(target, 'outside content\n', 'utf8');

    const readRes = await readTool.execute({ file_path: target }, makeCtx(sandbox));
    expect(readRes.isError).toBeFalsy();
    expect(String(readRes.content)).toContain('outside content');
  });

  it('writes and edits OUTSIDE cwd succeed (no "outside the allowed directories" error)', async () => {
    const outside = await makeSandbox('bpt-fs-outside2-');
    const target = path.join(outside, 'out.txt');
    const ctx = makeCtx(sandbox);

    const writeRes = await writeTool.execute({ file_path: target, content: 'hello outside' }, ctx);
    expect(writeRes.isError).toBeFalsy();
    expect(await readFile(target, 'utf8')).toBe('hello outside');

    const editRes = await editTool.execute(
      { file_path: target, old_string: 'hello', new_string: 'bye' },
      ctx,
    );
    expect(editRes.isError).toBeFalsy();
    expect(await readFile(target, 'utf8')).toBe('bye outside');

    for (const res of [writeRes, editRes, await readTool.execute({ file_path: target }, ctx)]) {
      expect(String(res.content)).not.toMatch(/outside the allowed directories/i);
    }
  });

  it('a sibling dir sharing a name prefix is reachable too (no fence to trip on)', async () => {
    const root = await makeSandbox('bpt-fs-prefix-');
    const cwd = path.join(root, 'proj');
    const sibling = path.join(root, 'projX');
    await mkdir(cwd);
    await mkdir(sibling);
    const target = path.join(sibling, 'file.txt');
    await writeFile(target, 'sibling content\n', 'utf8');

    const readRes = await readTool.execute({ file_path: target }, makeCtx(cwd));
    expect(readRes.isError).toBeFalsy();
    expect(String(readRes.content)).toContain('sibling content');
  });

  it('relative traversal escaping cwd resolves and succeeds', async () => {
    const outside = await makeSandbox('bpt-fs-escape-');
    const rel = path.relative(sandbox, path.join(outside, 'esc.txt'));
    expect(rel.startsWith('..')).toBe(true); // sanity: really escapes

    const res = await writeTool.execute({ file_path: rel, content: 'escaped' }, makeCtx(sandbox));
    expect(res.isError).toBeFalsy();
    expect(await readFile(path.join(outside, 'esc.txt'), 'utf8')).toBe('escaped');
  });

  it('additionalDirectories access still works (its surviving role is sandbox writablePaths)', async () => {
    const extra = await makeSandbox('bpt-fs-extra-');
    const ctx = makeCtx(sandbox, { additionalDirectories: [extra] });
    const target = path.join(extra, 'shared.txt');

    const writeRes = await writeTool.execute({ file_path: target, content: 'shared data' }, ctx);
    expect(writeRes.isError).toBeFalsy();
    const readRes = await readTool.execute({ file_path: target }, ctx);
    expect(readRes.content).toBe(catLine(1, 'shared data'));
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('abort handling', () => {
  it('Read rejects with AbortError on a pre-aborted signal (no isError payload)', async () => {
    const file = path.join(sandbox, 'abort-read.txt');
    await writeFile(file, 'data\n', 'utf8');

    await expect(
      readTool.execute({ file_path: file }, abortedCtx(sandbox)),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('Write rejects with AbortError on a pre-aborted signal and writes nothing', async () => {
    const file = path.join(sandbox, 'abort-write.txt');

    await expect(
      writeTool.execute(
        { file_path: file, content: 'never' },
        abortedCtx(sandbox),
      ),
    ).rejects.toBeInstanceOf(AbortError);

    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Edit rejects with AbortError on a pre-aborted signal and leaves the file intact', async () => {
    const file = path.join(sandbox, 'abort-edit.txt');
    await writeFile(file, 'original\n', 'utf8');

    await expect(
      editTool.execute(
        { file_path: file, old_string: 'original', new_string: 'changed' },
        abortedCtx(sandbox),
      ),
    ).rejects.toBeInstanceOf(AbortError);

    expect(await readFile(file, 'utf8')).toBe('original\n');
  });
});

// ---------------------------------------------------------------------------
// E4: read-before-write gate (official semantics, pinned live in L5 code-03
// r1 vs r2 + KD-L3-06): a Write over an EXISTING file the session has not
// Read is rejected verbatim; new files pass; a prior Read unlocks. The gate
// state is ctx.readFilePaths (one Set per query); absent -> gate off.
// ---------------------------------------------------------------------------

const GATE_ERROR =
  '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>';

describe('Write read-before-write gate (E4)', () => {
  let sandbox: string;
  let readPaths: Set<string>;

  beforeEach(async () => {
    sandbox = await makeSandbox('fs-gate-');
    readPaths = new Set<string>();
  });

  const gatedCtx = (): ToolContext => makeCtx(sandbox, { readFilePaths: readPaths });

  it('creating a NEW file passes the gate', async () => {
    const res = await writeTool.execute(
      { file_path: 'fresh.txt', content: 'hi' },
      gatedCtx(),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(path.join(sandbox, 'fresh.txt'), 'utf8')).toBe('hi');
  });

  it('overwriting an existing un-read file is rejected with the verbatim official error and leaves the file untouched', async () => {
    const file = path.join(sandbox, 'exists.txt');
    await writeFile(file, 'old\n', 'utf8');

    const res = await writeTool.execute(
      { file_path: file, content: 'new\n' },
      gatedCtx(),
    );

    expect(res.isError).toBe(true);
    expect(res.content).toBe(GATE_ERROR);
    expect(await readFile(file, 'utf8')).toBe('old\n');
  });

  it('a successful Read unlocks the overwrite', async () => {
    const file = path.join(sandbox, 'exists.txt');
    await writeFile(file, 'old\n', 'utf8');

    const read = await readTool.execute({ file_path: file }, gatedCtx());
    expect(read.isError).toBeFalsy();

    const res = await writeTool.execute(
      { file_path: file, content: 'new\n' },
      gatedCtx(),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('new\n');
  });

  it('reading an EMPTY file still registers (the session saw the content)', async () => {
    const file = path.join(sandbox, 'empty.txt');
    await writeFile(file, '', 'utf8');

    const read = await readTool.execute({ file_path: file }, gatedCtx());
    expect(read.isError).toBeFalsy();

    const res = await writeTool.execute(
      { file_path: file, content: 'filled\n' },
      gatedCtx(),
    );
    expect(res.isError).toBeFalsy();
  });

  it('a FAILED Read (nonexistent file) does not register the path', async () => {
    const file = path.join(sandbox, 'ghost.txt');
    const read = await readTool.execute({ file_path: file }, gatedCtx());
    expect(read.isError).toBe(true);

    // Now create it out-of-band; the gate must still block (never read).
    await writeFile(file, 'appeared\n', 'utf8');
    const res = await writeTool.execute(
      { file_path: file, content: 'clobber\n' },
      gatedCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toBe(GATE_ERROR);
  });

  it('Write registers its own path: create-then-revise does not self-block', async () => {
    const first = await writeTool.execute(
      { file_path: 'draft.txt', content: 'v1' },
      gatedCtx(),
    );
    expect(first.isError).toBeFalsy();

    const second = await writeTool.execute(
      { file_path: 'draft.txt', content: 'v2' },
      gatedCtx(),
    );
    expect(second.isError).toBeFalsy();
    expect(await readFile(path.join(sandbox, 'draft.txt'), 'utf8')).toBe('v2');
  });

  it('a successful Edit registers the path (Edit read the content to apply the change)', async () => {
    const file = path.join(sandbox, 'editable.txt');
    await writeFile(file, 'alpha beta\n', 'utf8');

    const edit = await editTool.execute(
      { file_path: file, old_string: 'alpha', new_string: 'gamma' },
      gatedCtx(),
    );
    expect(edit.isError).toBeFalsy();

    const res = await writeTool.execute(
      { file_path: file, content: 'rewritten\n' },
      gatedCtx(),
    );
    expect(res.isError).toBeFalsy();
  });

  it('the Set is shared by reference: a Read in one context unlocks a Write in another (subagent semantics)', async () => {
    const file = path.join(sandbox, 'shared.txt');
    await writeFile(file, 'old\n', 'utf8');

    // "Parent" reads...
    const parentCtx = makeCtx(sandbox, { readFilePaths: readPaths });
    const read = await readTool.execute({ file_path: file }, parentCtx);
    expect(read.isError).toBeFalsy();

    // ..."child" (fresh context object, SAME Set reference) writes.
    const childCtx = makeCtx(sandbox, { readFilePaths: readPaths });
    const res = await writeTool.execute(
      { file_path: file, content: 'new\n' },
      childCtx,
    );
    expect(res.isError).toBeFalsy();
  });

  it('gate absent (no readFilePaths) keeps the legacy overwrite behavior', async () => {
    const file = path.join(sandbox, 'legacy.txt');
    await writeFile(file, 'old\n', 'utf8');

    const res = await writeTool.execute(
      { file_path: file, content: 'new\n' },
      makeCtx(sandbox),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('new\n');
  });
});

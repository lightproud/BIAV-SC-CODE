/**
 * MCP result mapping: image mimeType whitelist (v0.56.0). An MCP server is
 * free to label image content with any mimeType; an off-vocabulary
 * media_type riding into the next API request 400s the whole turn on the
 * Anthropic protocol. mapMcpResult degrades those to an explicit text
 * marker instead — never silently dropped, never a poisoned wire request.
 */

import { describe, expect, it } from 'vitest';

import { mapMcpResult } from '../src/engine/tool-dispatch.js';
import type { CallToolResult } from '../src/types.js';

describe('mapMcpResult image mimeType whitelist', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'passes a supported %s image through as an image block',
    (mimeType) => {
      const res: CallToolResult = {
        content: [{ type: 'image', mimeType, data: 'QUJD' }],
      };
      expect(mapMcpResult(res)).toEqual({
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: 'QUJD' } },
        ],
        isError: false,
      });
    },
  );

  it('normalizes mimeType case/whitespace before whitelisting', () => {
    const res: CallToolResult = {
      content: [{ type: 'image', mimeType: ' IMAGE/PNG ', data: 'QUJD' }],
    };
    expect(mapMcpResult(res)).toEqual({
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
      isError: false,
    });
  });

  it('degrades an unsupported mimeType to an explicit text marker (no silent drop)', () => {
    const res: CallToolResult = {
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', mimeType: 'image/bmp', data: 'QUJD' },
        { type: 'text', text: 'after' },
      ],
    };
    const mapped = mapMcpResult(res);
    expect(mapped.content).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'text',
        text:
          '[image omitted: unsupported media type "image/bmp"; ' +
          'supported: image/jpeg, image/png, image/gif, image/webp]',
      },
      { type: 'text', text: 'after' },
    ]);
    // The marker must not leak the image payload.
    expect(JSON.stringify(mapped)).not.toContain('QUJD');
  });
});

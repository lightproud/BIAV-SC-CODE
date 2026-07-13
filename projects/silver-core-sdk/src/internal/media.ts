/**
 * Silver Core SDK - shared media-type vocabulary.
 *
 * Single source for the image media types the Messages API documents
 * (and the OpenAI translation's data-URL path accepts). Both the wire
 * translator (transport/openai.ts) and the MCP result mapper
 * (engine/tool-dispatch.ts) validate against THIS set, so an image an MCP
 * server labels with an off-vocabulary mimeType is caught at the dispatch
 * seam (degraded to an explicit text marker) instead of 400-ing the whole
 * next API request server-side.
 */

export const SUPPORTED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Human-readable list for error/marker messages (stable order). */
export const SUPPORTED_IMAGE_MEDIA_TYPES_LIST = [...SUPPORTED_IMAGE_MEDIA_TYPES].join(', ');

/** Normalize a raw media type (trim + lowercase); undefined when the result
 *  is not one of the supported image types. */
export function normalizeImageMediaType(raw: string): string | undefined {
  const mediaType = raw.trim().toLowerCase();
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType) ? mediaType : undefined;
}

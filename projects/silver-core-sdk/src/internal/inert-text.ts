/**
 * Inert-text helpers (audit 2026-07-17 batch J: N1/N8/N9/L2-7/L2-8) — the ONE
 * shared toolkit for embedding UNTRUSTED text (transcripts, session content,
 * code under review, event keys) inside a model-facing structural envelope
 * (a pseudo-XML fence, a pseudo-XML attribute, a line-oriented digest).
 *
 * Threat model: the embedded text is data, but the envelope around it is
 * STRUCTURE the model parses. Text that contains the envelope's own closing
 * tag / quote / newline can terminate the envelope early and smuggle forged
 * structure after it (a fake verdict, a forged "already reported" ledger line,
 * text outside a retained-context boundary). Each helper breaks exactly the
 * terminator its envelope trusts, changes nothing else, and is idempotent-safe
 * (re-escaping already-escaped text cannot re-arm a terminator).
 */

/**
 * Neutralize any literal `</tag` inside text destined for a `<tag>...</tag>`
 * fence, so the embedded text can never close the fence early. The `<` of the
 * would-be terminator is replaced with a backslash-escaped form (`<\/tag`),
 * case-insensitively, preserving the original tag casing for readability.
 */
export function neutralizeClosingTag(text: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`</(${escapedTag})`, 'gi'), '<\\/$1');
}

/**
 * Escape a value for use inside a double-quoted pseudo-XML attribute
 * (`title="..."`): `&` `"` `<` `>` become entities and CR/LF collapse to a
 * space, so the value can neither break out of the quotes nor fork the tag
 * across lines.
 */
export function escapeTagAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Collapse a value to one line (CR/LF runs become a single space) for
 * line-oriented digests where each line is a separate record: embedded
 * newlines are how a key/summary forges extra records.
 */
export function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

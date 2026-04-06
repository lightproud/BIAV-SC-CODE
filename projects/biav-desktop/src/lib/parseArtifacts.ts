import type { Artifact } from '../types'

let counter = 0
function nextId(): string {
  return `artifact-${++counter}`
}

/**
 * Parse assistant messages for artifact blocks.
 *
 * Supported formats:
 * 1. XML-style:  <artifact type="code" title="hello.py" language="python">...</artifact>
 * 2. Fenced with marker:  ```artifact:type:title\n...\n```
 * 3. Standard fenced code blocks are treated as implicit code artifacts
 */
export function parseArtifacts(messages: { role: string; content: string }[]): Artifact[] {
  const artifacts: Artifact[] = []
  counter = 0

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue

    // 1. XML-style artifacts
    const xmlRe = /<artifact\s+([^>]+)>([\s\S]*?)<\/artifact>/g
    let m: RegExpExecArray | null
    while ((m = xmlRe.exec(msg.content)) !== null) {
      const attrs = m[1]
      const content = m[2].trim()
      const type = extractAttr(attrs, 'type') || inferType(content)
      const title = extractAttr(attrs, 'title') || `Artifact`
      const language = extractAttr(attrs, 'language') || undefined
      artifacts.push({
        id: nextId(),
        type: normalizeType(type),
        title,
        content,
        language,
      })
    }

    // 2. Fenced with marker: ```artifact:type:title
    const markerRe = /```artifact:(\w+):([^\n]*)\n([\s\S]*?)```/g
    while ((m = markerRe.exec(msg.content)) !== null) {
      const type = m[1]
      const title = m[2].trim() || 'Artifact'
      const content = m[3].trim()
      artifacts.push({
        id: nextId(),
        type: normalizeType(type),
        title,
        content,
        language: type === 'code' ? undefined : undefined,
      })
    }

    // 3. Standard fenced code blocks (implicit code artifacts) — skip if already captured above
    const fencedRe = /```(\w+)?\n([\s\S]*?)```/g
    while ((m = fencedRe.exec(msg.content)) !== null) {
      const fullMatch = m[0]
      // Skip if this was already matched as an artifact marker
      if (fullMatch.startsWith('```artifact:')) continue
      // Skip if inside an <artifact> tag (rough check)
      const before = msg.content.slice(0, m.index)
      const openTags = (before.match(/<artifact\b/g) || []).length
      const closeTags = (before.match(/<\/artifact>/g) || []).length
      if (openTags > closeTags) continue

      const lang = m[1] || ''
      const content = m[2].trim()
      if (!content) continue

      // Determine type from language
      let type: Artifact['type'] = 'code'
      if (lang === 'html') type = 'html'
      else if (lang === 'svg') type = 'svg'
      else if (lang === 'markdown' || lang === 'md') type = 'markdown'

      const title = lang ? `${lang} snippet` : 'Code snippet'
      artifacts.push({
        id: nextId(),
        type,
        title,
        content,
        language: lang || undefined,
      })
    }
  }

  return artifacts
}

function extractAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}=["']([^"']*)["']`)
  const m = re.exec(attrs)
  return m ? m[1] : undefined
}

function inferType(content: string): string {
  if (content.trimStart().startsWith('<svg')) return 'svg'
  if (content.trimStart().startsWith('<!') || content.trimStart().startsWith('<html')) return 'html'
  return 'code'
}

function normalizeType(t: string): Artifact['type'] {
  if (t === 'html') return 'html'
  if (t === 'svg') return 'svg'
  if (t === 'markdown' || t === 'md') return 'markdown'
  return 'code'
}

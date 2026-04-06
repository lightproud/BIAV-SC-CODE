import type { Artifact, ArtifactVersion } from '../types'

let counter = 0
function nextId(): string {
  return `artifact-${++counter}`
}

interface RawArtifact {
  type: Artifact['type']
  title: string
  content: string
  language?: string
  messageId: string
  timestamp: number
}

/**
 * Parse assistant messages for artifact blocks.
 *
 * Supported formats:
 * 1. XML-style:  <artifact type="code" title="hello.py" language="python">...</artifact>
 * 2. Fenced with marker:  ```artifact:type:title\n...\n```
 * 3. Standard fenced code blocks are treated as implicit code artifacts
 *
 * Artifacts with the same title (or same language + type for implicit snippets)
 * across different messages are merged as versions of a single artifact.
 */
export function parseArtifacts(messages: { id?: string; role: string; content: string; created_at?: string }[]): Artifact[] {
  const raw: RawArtifact[] = []
  counter = 0

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx]
    if (msg.role !== 'assistant') continue

    const messageId = msg.id || `msg-${msgIdx}`
    const timestamp = msg.created_at ? new Date(msg.created_at).getTime() : msgIdx

    // 1. XML-style artifacts
    const xmlRe = /<artifact\s+([^>]+)>([\s\S]*?)<\/artifact>/g
    let m: RegExpExecArray | null
    while ((m = xmlRe.exec(msg.content)) !== null) {
      const attrs = m[1]
      const content = m[2].trim()
      const type = extractAttr(attrs, 'type') || inferType(content)
      const title = extractAttr(attrs, 'title') || `Artifact`
      const language = extractAttr(attrs, 'language') || undefined
      raw.push({
        type: normalizeType(type),
        title,
        content,
        language,
        messageId,
        timestamp,
      })
    }

    // 2. Fenced with marker: ```artifact:type:title
    const markerRe = /```artifact:(\w+):([^\n]*)\n([\s\S]*?)```/g
    while ((m = markerRe.exec(msg.content)) !== null) {
      const type = m[1]
      const title = m[2].trim() || 'Artifact'
      const content = m[3].trim()
      raw.push({
        type: normalizeType(type),
        title,
        content,
        messageId,
        timestamp,
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
      raw.push({
        type,
        title,
        content,
        language: lang || undefined,
        messageId,
        timestamp,
      })
    }
  }

  // Merge raw artifacts into versioned artifacts.
  // Match by: exact title, or same type+language for implicit snippets.
  const artifacts: Artifact[] = []
  const titleMap = new Map<string, number>() // title -> index in artifacts[]

  for (const r of raw) {
    const key = r.title.toLowerCase()
    const existingIdx = titleMap.get(key)

    if (existingIdx !== undefined) {
      // Same title — add as new version
      const existing = artifacts[existingIdx]
      // Only add if content actually changed
      if (existing.versions[existing.versions.length - 1].content !== r.content) {
        existing.versions.push({
          content: r.content,
          timestamp: r.timestamp,
          messageId: r.messageId,
        })
        // Update current to latest
        existing.currentVersion = existing.versions.length - 1
        existing.content = r.content
      }
    } else {
      // New artifact
      const version: ArtifactVersion = {
        content: r.content,
        timestamp: r.timestamp,
        messageId: r.messageId,
      }
      const artifact: Artifact = {
        id: nextId(),
        type: r.type,
        title: r.title,
        content: r.content,
        language: r.language,
        versions: [version],
        currentVersion: 0,
      }
      titleMap.set(key, artifacts.length)
      artifacts.push(artifact)
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

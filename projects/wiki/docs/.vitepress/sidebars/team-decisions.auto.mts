// Auto-generated sidebar for /zh/team-decisions/
// 艾瑞卡档案接入模块：启动时扫描所有决策 md，按 frontmatter 分类。
// 不要手动编辑此数组——新增决策文件会自动出现在 sidebar。

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

interface DecisionMeta {
  serial: string
  slug: string
  title: string
  category: string
  date: string
  link: string
}

type SidebarItem = { text: string; link?: string; collapsed?: boolean; items?: SidebarItem[] }

// Minimal frontmatter parser (only needs title / category / date; quoted strings).
function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const body = match[1]
  const result: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
    if (!m) continue
    let value = m[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[m[1]] = value
  }
  return result
}

function loadDecisions(): DecisionMeta[] {
  const here = dirname(fileURLToPath(import.meta.url))
  // sidebars/ -> .vitepress/ -> docs/ -> zh/team-decisions
  const dir = resolve(here, '..', '..', 'zh', 'team-decisions')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md')
  } catch {
    return []
  }
  const metas: DecisionMeta[] = []
  for (const file of files) {
    const slug = file.replace(/\.md$/, '')
    const serialMatch = slug.match(/^(\d+)-(.+)$/)
    if (!serialMatch) continue
    const serial = serialMatch[1]
    const raw = readFileSync(join(dir, file), 'utf-8')
    const fm = parseFrontmatter(raw)
    metas.push({
      serial,
      slug,
      title: fm.title || slug,
      category: fm.category || '未分类',
      date: fm.date || '',
      link: `/zh/team-decisions/${slug}`,
    })
  }
  // Sort ascending by serial number.
  metas.sort((a, b) => Number(a.serial) - Number(b.serial))
  return metas
}

export function buildTeamDecisionsSidebar(): SidebarItem {
  const metas = loadDecisions()

  const global: SidebarItem[] = []
  const subProject: SidebarItem[] = []
  const other: SidebarItem[] = []

  for (const meta of metas) {
    const item: SidebarItem = {
      text: `${meta.serial} ${meta.title}`,
      link: meta.link,
    }
    if (meta.category === '全局') global.push(item)
    else if (meta.category === '子项目') subProject.push(item)
    else other.push(item)
  }

  const groups: SidebarItem[] = [
    { text: '索引', link: '/zh/team-decisions/' },
  ]
  if (global.length > 0) {
    groups.push({ text: `全局（${global.length}）`, collapsed: true, items: global })
  }
  if (subProject.length > 0) {
    groups.push({ text: `子项目（${subProject.length}）`, collapsed: true, items: subProject })
  }
  if (other.length > 0) {
    groups.push({ text: `其他（${other.length}）`, collapsed: true, items: other })
  }

  return {
    text: '团队决策事实',
    collapsed: true,
    items: groups,
  }
}

export default buildTeamDecisionsSidebar

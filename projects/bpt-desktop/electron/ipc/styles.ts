import { ipcMain } from 'electron'
import Store from 'electron-store'

export interface Style {
  id: string
  name: string
  description: string
  prompt: string
  isBuiltin: boolean
  icon?: string
}

const BUILTIN_STYLES: Style[] = [
  {
    id: 'builtin-formal',
    name: '正式',
    description: '专业、结构化、客观的回复风格',
    prompt: '请使用正式、专业的语气回复。保持结构化、客观，使用清晰的逻辑和准确的措辞。避免口语化表达，适当使用标题和列表来组织内容。',
    isBuiltin: true,
    icon: '📝',
  },
  {
    id: 'builtin-concise',
    name: '简洁',
    description: '直接、简短、高效的回答',
    prompt: '请尽量简洁地回复。直奔主题，省略不必要的解释和铺垫。用最少的文字传达最核心的信息。如非必要，不要使用列表或标题。',
    isBuiltin: true,
    icon: '💬',
  },
  {
    id: 'builtin-detailed',
    name: '详细',
    description: '深入、全面、带示例的解释',
    prompt: '请提供深入、全面的回复。包含背景信息、详细解释、具体示例和相关延伸。使用标题、列表和代码块等格式来组织长内容，确保读者能全面理解。',
    isBuiltin: true,
    icon: '📖',
  },
  {
    id: 'builtin-creative',
    name: '创意',
    description: '生动、有创意、善用比喻',
    prompt: '请用生动、富有创意的方式回复。善用比喻、类比和故事来解释概念。语言可以更加活泼有趣，但仍然确保信息的准确性。',
    isBuiltin: true,
    icon: '🎨',
  },
  {
    id: 'builtin-technical',
    name: '技术',
    description: '精确、代码导向、工程化思维',
    prompt: '请以技术导向的方式回复。优先使用精确的技术术语，提供代码示例，关注实现细节和最佳实践。以工程化思维分析问题，考虑性能、可维护性和边界情况。',
    isBuiltin: true,
    icon: '💻',
  },
]

const store = new Store<{ customStyles: Style[] }>()

function getCustomStyles(): Style[] {
  return (store.get('customStyles') as Style[] | undefined) || []
}

function saveCustomStyles(styles: Style[]) {
  store.set('customStyles', styles)
}

export function registerStyleHandlers() {
  ipcMain.handle('styles:list', () => {
    const custom = getCustomStyles()
    return [...BUILTIN_STYLES, ...custom]
  })

  ipcMain.handle('styles:save', (_e, style: Omit<Style, 'isBuiltin'>) => {
    const custom = getCustomStyles()
    const existing = custom.findIndex((s) => s.id === style.id)
    const saved: Style = { ...style, isBuiltin: false }

    if (existing >= 0) {
      custom[existing] = saved
    } else {
      custom.push(saved)
    }

    saveCustomStyles(custom)
    return saved
  })

  ipcMain.handle('styles:delete', (_e, id: string) => {
    // Prevent deleting built-in styles
    if (BUILTIN_STYLES.some((s) => s.id === id)) {
      return { ok: false }
    }
    const custom = getCustomStyles().filter((s) => s.id !== id)
    saveCustomStyles(custom)
    return { ok: true }
  })
}

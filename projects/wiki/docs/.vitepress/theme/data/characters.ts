// 结构化角色基线 (data/db/characters.json) 已于 2026-06-15 删除：
// 24/72 条全为 partial/fixture 占位、game_version 全 None，长期误导引用。
// 此处暂以空数组占位，待 Phase 2 W2 从 data/extracted/ 一手解包字段重建可信基线后接回。
// 接回方式：恢复 `import charactersJson from '../../../../data/db/characters.json'`
// 并将下方 `raw` 改回 `charactersJson as unknown as MorimensCharacter[]`。

export interface MorimensCharacter {
  id: string
  slug: string
  name_zh: string
  name_en: string | null
  name_ja: string | null
  title_zh: string
  realm: string | null
  role: string | null
  rarity?: string
  gender: string
  age: string
  height: string
  weight: string
  gi: string
  voice_actor: string
  painter: string
  introduction: string | null
  awaker_introduction: string | null
  characteristic: string[]
  summon_slogan: string | null
  skills: 'pending' | Record<string, unknown>
  trinkets: 'pending' | Record<string, unknown>
  commune: 'pending' | Record<string, unknown>
  background_story: 'pending' | string
  portraits: { default: string | null; awaker: string | null; skins: string[] }
  duplicate_bug: { duplicate_of: string; note: string; ruled_by: string } | null
  source: { extracted_from: string; extracted_at: string; game_version: string | null }
  last_verified: string
  status: 'stub' | 'partial' | 'complete' | 'fixture'
  trinkets_recommended?: Array<{ trinket_id: string; priority?: string; note?: string }>
  ascension_materials?: Record<string, Array<{ item_id: string; quantity: number }>>
  bond_rewards?: Array<{ level: number; unlocks: string[] }>
  stat_growth_curve?: { levels: Array<Record<string, number>>; note?: string }
  affinities?: { traits?: string[]; super_effective_against?: string[]; weak_against?: string[] }
  voice_line_refs?: number[]
  cg_refs?: string[]
}

const raw: MorimensCharacter[] = []

export const characters: MorimensCharacter[] = raw

export function findById(id: string): MorimensCharacter | undefined {
  return raw.find((c) => c.id === id)
}

export function findBySlug(slug: string): MorimensCharacter | undefined {
  return raw.find((c) => c.slug === slug)
}

export const REALM_LABELS: Record<string, string> = {
  caro: '血肉',
  aequor: '深海',
  ultra: '超维',
  chaos: '混沌',
}

export const ROLE_LABELS: Record<string, string> = {
  attack: '输出',
  sub_attack: '副输出',
  support: '辅助',
  defense: '防御',
  healer: '治疗',
  chorus: '合唱',
}

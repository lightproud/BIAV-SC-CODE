// W2 数据桥（2026-07-02 接回）：消费 characters.runtime.json——由仓库根
// scripts/generate_wiki_pages.py 的 generate_runtime_data() 从可信基线
// projects/wiki/data/processed/characters.json（72 真实角色，一手解包）+
// 玩法层（character_skills.md，界域/定位唯一来源，社区源）生成。
// 手改本产物无效，改数据请改上游基线后重跑生成器。
//
// 溯源：旧 data/db/ 结构化层 2026-06-15 守密人裁定整层清空（占位数据误导），
// 本桥曾以空数组占位；skills/trinkets 等结构化战斗字段为已知解包缺口
// （memory/wiki-phase-2-gap-inventory.md），接口中保留为可选位。

import runtime from './characters.runtime.json'

export interface MorimensCharacter {
  id: string
  slug: string
  name_zh: string
  name_en: string | null
  title_zh: string
  realm: string | null
  /** 玩法定位（社区源自由文本，如「反击输出」；非枚举） */
  role: string | null
  /** 守密人 2026-06-16 逐一裁定的类目：playable / unreleased / easter_egg */
  status: string
  /** 仅 playable 有详情页（/zh/awakeners/{slug}.html） */
  has_page: boolean
  gender: string
  birthday: string
  height: string
  weight: string
  gi: string
  voice_actor: string
  painter: string
  characteristic: string
  introduction: string | null
  summon_slogan: string | null
  portraits: { default: string | null; awaker: string | null; skins: string[] }
  // —— 以下为解包缺口字段，基线尚无数据，留作 W2 后续补全位 ——
  skills?: Record<string, unknown>
  trinkets_recommended?: Array<{ trinket_id: string; priority?: string; note?: string }>
  ascension_materials?: Record<string, Array<{ item_id: string; quantity: number }>>
  bond_rewards?: Array<{ level: number; unlocks: string[] }>
  stat_growth_curve?: { levels: Array<Record<string, number>>; note?: string }
  affinities?: { traits?: string[]; super_effective_against?: string[]; weak_against?: string[] }
  voice_line_refs?: number[]
  cg_refs?: string[]
}

const raw = runtime as unknown as MorimensCharacter[]

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

/** 类目标签（status = 守密人裁定类目） */
export const STATUS_LABELS: Record<string, string> = {
  playable: '可玩',
  unreleased: '未上线',
  easter_egg: '彩蛋',
}

/** 旧枚举定位标签，保留给未来结构化 role；现行 role 为自由文本，查不到时原样显示 */
export const ROLE_LABELS: Record<string, string> = {
  attack: '输出',
  sub_attack: '副输出',
  support: '辅助',
  defense: '防御',
  healer: '治疗',
  chorus: '合唱',
}

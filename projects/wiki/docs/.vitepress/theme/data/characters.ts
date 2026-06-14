// 数据源：projects/wiki/data/processed/characters.json
// （客户端 AwakerConfig.lua 运行时内存解包，72 真实唤醒体，_meta.total_characters = 72）
//
// 历史说明：本模块原先读取手工策展的 data/db/characters.json（仅 24 条 stub），
// 2026-06-14 守密人裁定删除该草稿，改以解包真实数据 processed/characters.json 为唯一源。
// processed 为扁平 schema，此处在导入时适配为下方 MorimensCharacter 富结构：
//   - 解包已有字段直接映射（姓名/称号/性别/生日/身高/体重/GI/声优/画师/简介/玩法简介/特性/召唤台词）
//   - 解包未覆盖字段以占位补齐（技能/神器/羁绊 = 'pending'，立绘 = null，界域/定位 = null）
//   - slug：保留原 24 条已知英文 slug（SLUG_MAP），其余用稳定的 `awk-<id>`
import charactersData from '../../../../data/processed/characters.json'

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

// 解包源（processed）的扁平记录形态
interface RawCharacter {
  id: number
  name: string
  title: string
  gender: string
  birthday: string
  height: string
  weight: string
  gi: string
  voice_actor: string
  painter: string
  characteristic: string
  introduction: string
  gameplay_intro: string
  summon_slogan: string
}

interface ProcessedFile {
  _meta: { source: string; total_characters: number; generated: string }
  characters: RawCharacter[]
}

const file = charactersData as unknown as ProcessedFile

// 原 db/characters.json 中 24 条已策展 slug，按 id 保留以延续既有详情页 URL 与立绘命名
const SLUG_MAP: Record<string, string> = {
  '15560': 'pandia', '15561': 'source_tincture', '15562': 'lizz', '15563': 'tulu',
  '15564': 'goliath', '15565': 'notilia', '15566': 'celeste', '15567': 'bloodchain_hilo',
  '15568': 'cycle_ramona', '15569': 'rotan', '15570': 'dole', '15571': 'garen',
  '15572': 'cassia', '15573': 'orita', '15574': 'tincture', '15575': 'faros',
  '15576': 'murphy', '15577': 'faint', '15578': 'jenkin', '15579': 'winkle',
  '15580': 'nymphia', '15581': 'lily', '15582': 'miriam', '15593': 'jenkin_duplicate_15593',
}

// 解包源未带界域/定位字段；下列为已确证的公开事实覆盖（其余留空待补）
const REALM_OVERRIDES: Record<string, string> = { '15560': 'caro' }
const ROLE_OVERRIDES: Record<string, string> = { '15560': 'attack' }

function splitCharacteristic(s: string): string[] {
  return (s || '').split(/\s+/).map((t) => t.trim()).filter(Boolean)
}

function adapt(r: RawCharacter): MorimensCharacter {
  const id = String(r.id)
  return {
    id,
    slug: SLUG_MAP[id] || `awk-${id}`,
    name_zh: r.name,
    name_en: null,
    name_ja: null,
    title_zh: r.title || r.name,
    realm: REALM_OVERRIDES[id] ?? null,
    role: ROLE_OVERRIDES[id] ?? null,
    gender: r.gender,
    age: r.birthday,
    height: r.height,
    weight: r.weight,
    gi: r.gi,
    voice_actor: r.voice_actor,
    painter: r.painter,
    introduction: r.introduction || null,
    awaker_introduction: r.gameplay_intro || null,
    characteristic: splitCharacteristic(r.characteristic),
    summon_slogan: r.summon_slogan || null,
    skills: 'pending',
    trinkets: 'pending',
    commune: 'pending',
    background_story: 'pending',
    portraits: { default: null, awaker: null, skins: [] },
    duplicate_bug: null,
    source: {
      extracted_from: file._meta?.source || 'AwakerConfig.lua',
      extracted_at: file._meta?.generated || '',
      game_version: null,
    },
    last_verified: file._meta?.generated || '',
    status: 'partial',
  }
}

const raw: MorimensCharacter[] = (file.characters || []).map(adapt)

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

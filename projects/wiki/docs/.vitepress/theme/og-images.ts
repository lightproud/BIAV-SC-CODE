/**
 * Dynamic OG image generation using SVG templates.
 *
 * This module provides a VitePress `buildEnd` hook that generates
 * SVG-based Open Graph images for social sharing. No canvas or
 * sharp dependency required -- pure SVG output that browsers and
 * social-media crawlers can render.
 *
 * Usage in config.mts:
 *
 * ```ts
 * import { generateOgImages } from './theme/og-images'
 * export default defineConfig({
 *   buildEnd: generateOgImages,
 * })
 * ```
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SiteConfig } from 'vitepress'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const BRAND_PURPLE = '#6d5dfc'
const BRAND_LIGHT = '#c084fc'
const BG_COLOR = '#0f0a1a'
const TEXT_COLOR = '#e8e0f0'

// The inline logo path data extracted from logo.svg for embedding
const LOGO_CIRCLE_OUTER = 'M64 4a60 60 0 1 0 0 120A60 60 0 1 0 64 4Z'
const LOGO_FACE = 'M44 50 C44 40, 84 40, 84 50 L84 78 C84 88, 44 88, 44 78 Z'

// ---------------------------------------------------------------------------
// SVG Template
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Wrap long text into multiple lines for SVG <text> elements.
 * Returns an array of lines, each within the given character limit.
 */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const lines: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining)
      break
    }

    // Try to break at a space, CJK boundary, or punctuation
    let breakIdx = maxChars
    for (let i = maxChars; i > maxChars * 0.5; i--) {
      const ch = remaining[i]
      if (ch === ' ' || ch === '/' || ch === '-' || ch === '|') {
        breakIdx = i
        break
      }
    }

    lines.push(remaining.slice(0, breakIdx).trim())
    remaining = remaining.slice(breakIdx).trim()

    if (lines.length >= 3) {
      if (remaining.length > 0) {
        lines[lines.length - 1] += '...'
      }
      break
    }
  }

  return lines
}

function generateOgSvg(title: string, section: string, locale: string): string {
  const escapedTitle = escapeXml(title)
  const escapedSection = escapeXml(section)

  const siteLabel =
    locale === 'zh' ? '忘却前夜 Wiki' : locale === 'ja' ? '忘却前夜 Wiki' : 'Morimens Wiki'

  // Wrap title for multi-line display
  const titleLines = wrapText(escapedTitle, 28)
  const titleStartY = titleLines.length === 1 ? 300 : titleLines.length === 2 ? 270 : 250
  const titleLineHeight = 70

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="600" dy="${i === 0 ? 0 : titleLineHeight}">${line}</tspan>`
    )
    .join('\n        ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${BG_COLOR}"/>
      <stop offset="100%" style="stop-color:#1a1030"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${BRAND_PURPLE}"/>
      <stop offset="100%" style="stop-color:${BRAND_LIGHT}"/>
    </linearGradient>
    <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${BRAND_PURPLE};stop-opacity:0"/>
      <stop offset="15%" style="stop-color:${BRAND_PURPLE};stop-opacity:1"/>
      <stop offset="85%" style="stop-color:${BRAND_LIGHT};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${BRAND_LIGHT};stop-opacity:0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>

  <!-- Decorative grid pattern -->
  <g opacity="0.04" stroke="${BRAND_PURPLE}" stroke-width="1">
    ${Array.from({ length: 20 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="${OG_HEIGHT}"/>`).join('\n    ')}
    ${Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="${OG_WIDTH}" y2="${i * 60}"/>`).join('\n    ')}
  </g>

  <!-- Decorative circles -->
  <circle cx="1100" cy="100" r="200" fill="none" stroke="${BRAND_PURPLE}" stroke-width="1" opacity="0.08"/>
  <circle cx="1100" cy="100" r="150" fill="none" stroke="${BRAND_LIGHT}" stroke-width="1" opacity="0.06"/>
  <circle cx="100" cy="530" r="180" fill="none" stroke="${BRAND_PURPLE}" stroke-width="1" opacity="0.06"/>

  <!-- Logo area (scaled version of logo.svg) -->
  <g transform="translate(70, 60) scale(0.7)" opacity="0.9" filter="url(#glow)">
    <circle cx="64" cy="64" r="60" fill="url(#accent)" opacity="0.15"/>
    <circle cx="64" cy="64" r="48" fill="none" stroke="url(#accent)" stroke-width="3"/>
    <path d="${LOGO_FACE}" fill="none" stroke="url(#accent)" stroke-width="2.5"/>
    <circle cx="54" cy="60" r="4" fill="${BRAND_PURPLE}"/>
    <circle cx="74" cy="60" r="4" fill="${BRAND_LIGHT}"/>
    <path d="M56 72 Q64 80 72 72" fill="none" stroke="url(#accent)" stroke-width="2" stroke-linecap="round"/>
  </g>

  <!-- Site name -->
  <text x="165" y="105" font-family="'Segoe UI', 'Noto Sans SC', 'Noto Sans JP', Arial, sans-serif" font-size="28" font-weight="600" fill="${TEXT_COLOR}" opacity="0.9">${escapeXml(siteLabel)}</text>

  <!-- Separator line -->
  <rect x="60" y="180" width="1080" height="2" fill="url(#line-grad)" rx="1"/>

  <!-- Section badge -->
  <g transform="translate(60, 210)">
    <rect width="${escapedSection.length * 14 + 40}" height="36" rx="18" fill="${BRAND_PURPLE}" opacity="0.25"/>
    <text x="${(escapedSection.length * 14 + 40) / 2}" y="24" text-anchor="middle" font-family="'Segoe UI', 'Noto Sans SC', 'Noto Sans JP', Arial, sans-serif" font-size="16" font-weight="500" fill="${BRAND_LIGHT}">${escapedSection}</text>
  </g>

  <!-- Page title -->
  <text y="${titleStartY}" text-anchor="middle" font-family="'Segoe UI', 'Noto Sans SC', 'Noto Sans JP', Arial, sans-serif" font-size="56" font-weight="bold" fill="${TEXT_COLOR}" filter="url(#glow)">
        ${titleTspans}
  </text>

  <!-- Bottom bar -->
  <rect x="0" y="${OG_HEIGHT - 6}" width="${OG_WIDTH}" height="6" fill="url(#accent)"/>

  <!-- URL footer -->
  <text x="60" y="${OG_HEIGHT - 25}" font-family="'Segoe UI', monospace" font-size="16" fill="${TEXT_COLOR}" opacity="0.4">lightproud.github.io/brain-in-a-vat/wiki</text>

  <!-- Game name -->
  <text x="${OG_WIDTH - 60}" y="${OG_HEIGHT - 25}" text-anchor="end" font-family="'Segoe UI', 'Noto Sans SC', Arial, sans-serif" font-size="16" fill="${BRAND_LIGHT}" opacity="0.5">MORIMENS</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Section / locale detection
// ---------------------------------------------------------------------------

const SECTION_NAMES: Record<string, Record<string, string>> = {
  zh: {
    awakeners: '唤醒体图鉴',
    cards: '卡牌系统',
    realms: '界域系统',
    wheels: '命轮',
    covenants: '密契',
    'key-orders': '钥令',
    engravings: '刻印',
    modes: '游戏模式',
    stages: '关卡攻略',
    story: '剧情与世界观',
    items: '道具',
    events: '活动',
    guides: '攻略指南',
  },
  en: {
    awakeners: 'Awakener Database',
    cards: 'Card System',
    realms: 'Designated Realms',
    wheels: 'Wheels of Destiny',
    covenants: 'Covenants',
    'key-orders': 'Key Orders',
    engravings: 'Engravings',
    modes: 'Game Modes',
    stages: 'Stages',
    story: 'Story & Lore',
    items: 'Items',
    events: 'Events',
    guides: 'Guides',
  },
  ja: {
    awakeners: '覚醒体図鑑',
    cards: 'カードシステム',
    realms: '界域システム',
    wheels: '運命の輪',
    covenants: '密契',
    'key-orders': '鍵令',
    engravings: '刻印',
    modes: 'ゲームモード',
    stages: 'ステージ',
    story: 'ストーリー',
    items: 'アイテム',
    events: 'イベント',
    guides: '攻略',
  },
}

function parsePage(relativePath: string): { locale: string; section: string; slug: string } {
  const parts = relativePath.replace(/\.md$/, '').split('/')
  const locale = ['en', 'ja'].includes(parts[0]) ? parts[0] : 'zh'
  const section = parts[1] || ''
  const slug = parts.slice(2).join('/') || 'index'
  return { locale, section, slug }
}

// ---------------------------------------------------------------------------
// Build hook
// ---------------------------------------------------------------------------

/**
 * Walk the output directory for .html files and extract page info
 * to generate corresponding OG SVG images.
 */
function walkHtmlFiles(dir: string, base: string = ''): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...walkHtmlFiles(join(dir, entry.name), rel))
    } else if (entry.name.endsWith('.html')) {
      results.push(rel)
    }
  }
  return results
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/)
  if (match) {
    // Strip the " | Site Name" suffix that VitePress adds
    return match[1].split('|')[0].trim()
  }
  return 'Morimens Wiki'
}

/**
 * VitePress `buildEnd` hook. Generates OG image SVGs in the output directory.
 */
export async function generateOgImages(siteConfig: SiteConfig): Promise<void> {
  const outDir = siteConfig.outDir
  const ogDir = join(outDir, 'og')
  mkdirSync(ogDir, { recursive: true })

  const htmlFiles = walkHtmlFiles(outDir)

  let generated = 0

  for (const file of htmlFiles) {
    // Skip assets, 404, etc.
    if (file.startsWith('assets/') || file === '404.html') continue

    const htmlPath = join(outDir, file)
    const html = readFileSync(htmlPath, 'utf-8')
    const title = extractTitle(html)

    // Convert html path to relative page path
    // e.g. "zh/awakeners/list.html" -> "zh/awakeners/list"
    const pagePath = file.replace(/\/index\.html$/, '').replace(/\.html$/, '')
    const parts = pagePath.split('/')
    const locale = ['en', 'ja'].includes(parts[0]) ? parts[0] : 'zh'
    const section = parts[1] || ''
    const sectionLabel = SECTION_NAMES[locale]?.[section] || section || 'Wiki'

    const svg = generateOgSvg(title, sectionLabel, locale)
    const svgFileName = `${encodeURIComponent(title)}.svg`
    const svgPath = join(ogDir, svgFileName)

    writeFileSync(svgPath, svg, 'utf-8')
    generated++
  }

  console.log(`[og-images] Generated ${generated} OG images in ${ogDir}`)
}

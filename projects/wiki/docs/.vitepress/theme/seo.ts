/**
 * SEO utilities for VitePress build hooks.
 *
 * Generates Schema.org JSON-LD structured data, Open Graph meta tags,
 * Twitter Card meta tags, and canonical URLs for every page.
 */

import type { HeadConfig, TransformContext } from 'vitepress'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SITE_URL = 'https://lightproud.github.io/brain-in-a-vat/wiki'
const SITE_NAME = 'Morimens Wiki | 忘却前夜 Wiki'
const DEFAULT_IMAGE = `${SITE_URL}/logo.svg`
const TWITTER_HANDLE = '@morimens'

const GAME_META = {
  name: 'Morimens',
  alternateName: ['忘却前夜', '忘卻前夜', 'Eve of Oblivion'],
  genre: ['Roguelite', 'Card-building', 'Cthulhu Mythos', 'Turn-based RPG'],
  platforms: ['iOS', 'Android', 'PC (Steam)'],
  developer: 'B.I.A.V. Studio',
  publisher: [
    'Dreamstar Network Limited',
    'AltPlus Inc.',
    'Qookka Games',
  ],
  steamAppId: 3052450,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full canonical URL for a page path. */
function canonicalUrl(pageUrl: string): string {
  // pageUrl comes from VitePress as e.g. "zh/awakeners/" or "en/guides/faq"
  const clean = pageUrl.replace(/^\/+/, '').replace(/\.html$/, '')
  return `${SITE_URL}/${clean}`
}

/** Detect page category from its relative path. */
function detectPageType(relativePath: string): 'home' | 'character' | 'faq' | 'article' {
  if (/^[a-z]{2}\/index\.md$/.test(relativePath) || relativePath === 'index.md') {
    return 'home'
  }
  if (/awakeners\/[^/]+\.md$/.test(relativePath) && !relativePath.endsWith('index.md') && !relativePath.endsWith('list.md')) {
    return 'character'
  }
  if (/faq\.md$/.test(relativePath)) {
    return 'faq'
  }
  return 'article'
}

/** Detect locale from path. */
function detectLocale(relativePath: string): 'zh' | 'en' | 'ja' {
  if (relativePath.startsWith('en/')) return 'en'
  if (relativePath.startsWith('ja/')) return 'ja'
  return 'zh'
}

/** Infer a character name from the frontmatter or page title. */
function getCharacterName(title: string): string {
  // Titles like "艾尔瓦 (Alva)" -- extract both
  return title
}

/** Build an og:image URL for character pages (tries portrait, falls back to default). */
function ogImageForPage(relativePath: string, pageData: TransformContext['pageData']): string {
  // Character pages may reference a portrait via frontmatter `portrait`
  const portrait = pageData.frontmatter?.portrait as string | undefined
  if (portrait) {
    if (portrait.startsWith('http')) return portrait
    return `${SITE_URL}/${portrait.replace(/^\/+/, '')}`
  }

  // Try to build a dynamic OG image URL (SVG-based, see og-images.ts)
  const title = pageData.title || pageData.frontmatter?.title || ''
  if (title) {
    return `${SITE_URL}/og/${encodeURIComponent(title)}.svg`
  }

  return DEFAULT_IMAGE
}

// ---------------------------------------------------------------------------
// Structured Data Generators
// ---------------------------------------------------------------------------

function videoGameSchema(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: GAME_META.name,
    alternateName: GAME_META.alternateName,
    genre: GAME_META.genre,
    gamePlatform: GAME_META.platforms,
    applicationCategory: 'Game',
    operatingSystem: 'iOS, Android, Windows',
    author: {
      '@type': 'Organization',
      name: GAME_META.developer,
    },
    publisher: GAME_META.publisher.map((p) => ({
      '@type': 'Organization',
      name: p,
    })),
    url: `https://store.steampowered.com/app/${GAME_META.steamAppId}`,
    image: DEFAULT_IMAGE,
    description:
      'Morimens is a roguelite card-building game inspired by the Cthulhu mythos. Players craft versatile decks, explore misty maps, encounter random events, and uncover the truth of a dying world.',
  }
}

function articleSchema(title: string, description: string, url: string, locale: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    inLanguage: locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Morimens Wiki Contributors',
      logo: {
        '@type': 'ImageObject',
        url: DEFAULT_IMAGE,
      },
    },
    about: {
      '@type': 'VideoGame',
      name: GAME_META.name,
    },
  }
}

function faqSchema(title: string, url: string): object {
  // We generate a minimal FAQPage shell. Actual Q&A pairs would be
  // injected via frontmatter `faq` array if provided, but even the
  // type annotation alone improves rich-result eligibility.
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    name: title,
    url,
    mainEntity: [],
  }
}

function characterSchema(name: string, description: string, url: string, image: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: name,
    description,
    url,
    image,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
    about: {
      '@type': 'VideoGame',
      name: GAME_META.name,
    },
  }
}

function breadcrumbSchema(url: string, segments: { name: string; url: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: segments.map((seg, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: seg.name,
      item: seg.url,
    })),
  }
}

// ---------------------------------------------------------------------------
// Build breadcrumb segments from the page path
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, Record<string, string>> = {
  zh: {
    awakeners: '唤醒体',
    cards: '卡牌',
    realms: '界域',
    wheels: '命轮',
    covenants: '密契',
    'key-orders': '钥令',
    engravings: '刻印',
    modes: '游戏模式',
    stages: '关卡',
    story: '剧情',
    items: '道具',
    events: '活动',
    guides: '攻略',
  },
  en: {
    awakeners: 'Awakeners',
    cards: 'Cards',
    realms: 'Realms',
    wheels: 'Wheels of Destiny',
    covenants: 'Covenants',
    'key-orders': 'Key Orders',
    engravings: 'Engravings',
    modes: 'Game Modes',
    stages: 'Stages',
    story: 'Story',
    items: 'Items',
    events: 'Events',
    guides: 'Guides',
  },
  ja: {
    awakeners: '覚醒体',
    cards: 'カード',
    realms: '界域',
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

function buildBreadcrumbs(relativePath: string, title: string, locale: string): { name: string; url: string }[] {
  const parts = relativePath.replace(/\.md$/, '').split('/')
  // parts e.g. ["zh", "awakeners", "list"]
  const crumbs: { name: string; url: string }[] = [
    { name: locale === 'zh' ? '首页' : locale === 'ja' ? 'ホーム' : 'Home', url: `${SITE_URL}/${locale}/` },
  ]

  if (parts.length > 1) {
    const section = parts[1]
    const label = SECTION_LABELS[locale]?.[section] || section
    crumbs.push({ name: label, url: `${SITE_URL}/${locale}/${section}/` })
  }

  if (parts.length > 2 && parts[2] !== 'index') {
    crumbs.push({ name: title, url: canonicalUrl(relativePath.replace(/\.md$/, '')) })
  }

  return crumbs
}

// ---------------------------------------------------------------------------
// Public: transformHead hook
// ---------------------------------------------------------------------------

/**
 * VitePress `transformHead` hook. Call from config.mts:
 *
 * ```ts
 * import { generateSeoHead } from './theme/seo'
 * export default defineConfig({
 *   transformHead: generateSeoHead,
 * })
 * ```
 */
export function generateSeoHead(context: TransformContext): HeadConfig[] {
  const { pageData } = context
  const relativePath = pageData.relativePath // e.g. "zh/awakeners/list.md"
  const title = pageData.title || pageData.frontmatter?.title || SITE_NAME
  const description =
    (pageData.frontmatter?.description as string) ||
    pageData.description ||
    'Morimens (忘却前夜) Wiki - 全球游戏资料站'
  const locale = detectLocale(relativePath)
  const pageType = detectPageType(relativePath)
  const url = canonicalUrl(relativePath.replace(/\.md$/, ''))
  const image = ogImageForPage(relativePath, pageData)

  const heads: HeadConfig[] = []

  // ---- Canonical ----
  heads.push(['link', { rel: 'canonical', href: url }])

  // ---- Open Graph ----
  heads.push(['meta', { property: 'og:type', content: pageType === 'home' ? 'website' : 'article' }])
  heads.push(['meta', { property: 'og:title', content: title }])
  heads.push(['meta', { property: 'og:description', content: description }])
  heads.push(['meta', { property: 'og:url', content: url }])
  heads.push(['meta', { property: 'og:image', content: image }])
  heads.push(['meta', { property: 'og:site_name', content: SITE_NAME }])
  heads.push(['meta', { property: 'og:locale', content: locale === 'zh' ? 'zh_CN' : locale === 'ja' ? 'ja_JP' : 'en_US' }])

  // Alternate locale links for hreflang
  const basePath = relativePath.replace(/^(zh|en|ja)\//, '')
  for (const alt of ['zh', 'en', 'ja']) {
    if (alt !== locale) {
      const altLocaleCode = alt === 'zh' ? 'zh_CN' : alt === 'ja' ? 'ja_JP' : 'en_US'
      heads.push(['meta', { property: 'og:locale:alternate', content: altLocaleCode }])
      heads.push(['link', { rel: 'alternate', hreflang: alt === 'zh' ? 'zh-CN' : alt === 'ja' ? 'ja-JP' : 'en-US', href: `${SITE_URL}/${alt}/${basePath.replace(/\.md$/, '')}` }])
    }
  }
  // x-default
  heads.push(['link', { rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}/en/${basePath.replace(/\.md$/, '')}` }])

  // ---- Twitter Card ----
  heads.push(['meta', { name: 'twitter:card', content: 'summary_large_image' }])
  heads.push(['meta', { name: 'twitter:title', content: title }])
  heads.push(['meta', { name: 'twitter:description', content: description }])
  heads.push(['meta', { name: 'twitter:image', content: image }])

  // ---- JSON-LD Structured Data ----
  const schemas: object[] = []

  if (pageType === 'home') {
    schemas.push(videoGameSchema())
  } else if (pageType === 'faq') {
    schemas.push(faqSchema(title, url))
    // If frontmatter provides FAQ items, inject them
    const faqItems = pageData.frontmatter?.faq as Array<{ question: string; answer: string }> | undefined
    if (faqItems?.length) {
      const faqObj = schemas[schemas.length - 1] as Record<string, unknown>
      faqObj.mainEntity = faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      }))
    }
  } else if (pageType === 'character') {
    schemas.push(characterSchema(getCharacterName(title), description, url, image))
  } else {
    schemas.push(articleSchema(title, description, url, locale))
  }

  // Breadcrumbs for all non-home pages
  if (pageType !== 'home') {
    const crumbs = buildBreadcrumbs(relativePath, title, locale)
    if (crumbs.length > 1) {
      schemas.push(breadcrumbSchema(url, crumbs))
    }
  }

  // WebSite schema on home pages (enables sitelinks search box)
  if (pageType === 'home') {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
      description: 'Morimens (忘却前夜) community Wiki - game database, guides, and lore.',
      inLanguage: ['zh-CN', 'en-US', 'ja-JP'],
    })
  }

  for (const schema of schemas) {
    heads.push([
      'script',
      { type: 'application/ld+json' },
      JSON.stringify(schema),
    ])
  }

  return heads
}

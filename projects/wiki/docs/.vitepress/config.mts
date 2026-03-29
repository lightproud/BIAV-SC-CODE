import { defineConfig } from 'vitepress'
import { generateSeoHead } from './theme/seo'
import { generateOgImages } from './theme/og-images'

export default defineConfig({
  title: '忘却前夜 Wiki',
  description: '忘却前夜 (Morimens) 全球游戏资料站 - Roguelite 卡牌构筑手游百科',

  base: '/brain-in-a-vat/wiki/',
  ignoreDeadLinks: true,

  // --- SEO: Sitemap generation ---
  sitemap: {
    hostname: 'https://lightproud.github.io/brain-in-a-vat/wiki',
    transformItems: (items) => {
      return items.map((item) => {
        // Boost priority for key pages
        if (item.url.match(/^(zh|en|ja)\/$/) || item.url === '') {
          item.priority = 1.0
          item.changefreq = 'daily'
        } else if (item.url.includes('/awakeners/') || item.url.includes('/guides/')) {
          item.priority = 0.8
          item.changefreq = 'weekly'
        } else {
          item.priority = 0.6
          item.changefreq = 'weekly'
        }
        return item
      })
    },
  },

  // --- SEO: Inject structured data & meta tags per page ---
  transformHead: generateSeoHead,

  // --- SEO: Generate OG images after build ---
  buildEnd: generateOgImages,

  head: [
    // Base meta tags (page-specific ones added via transformHead)
    ['meta', { name: 'keywords', content: '忘却前夜,忘卻前夜,Morimens,wiki,攻略,唤醒体,卡牌,命轮,密契,克苏鲁,roguelite,card game,cthulhu' }],
    ['meta', { name: 'author', content: 'Morimens Wiki Contributors' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { name: 'googlebot', content: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' }],
    ['meta', { name: 'theme-color', content: '#6d5dfc' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/brain-in-a-vat/wiki/logo.svg' }],
  ],

  locales: {
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          {
            text: '图鉴',
            items: [
              { text: '唤醒体', link: '/zh/awakeners/' },
              { text: '卡牌', link: '/zh/cards/' },
              { text: '界域', link: '/zh/realms/' },
            ]
          },
          {
            text: '装备',
            items: [
              { text: '命轮', link: '/zh/wheels/' },
              { text: '密契', link: '/zh/covenants/' },
              { text: '钥令', link: '/zh/key-orders/' },
              { text: '刻印', link: '/zh/engravings/' },
            ]
          },
          {
            text: '游玩',
            items: [
              { text: '游戏模式', link: '/zh/modes/' },
              { text: '关卡', link: '/zh/stages/' },
              { text: '剧情', link: '/zh/story/' },
            ]
          },
          { text: '道具', link: '/zh/items/' },
          { text: '活动', link: '/zh/events/' },
          { text: '攻略', link: '/zh/guides/' },
          { text: '更新记录', link: '/zh/changelog' },
        ],
        sidebar: {
          '/zh/awakeners/': [
            {
              text: '唤醒体图鉴',
              items: [
                { text: '唤醒体总览', link: '/zh/awakeners/' },
                { text: '唤醒体列表', link: '/zh/awakeners/list' },
                { text: '唤醒体培养', link: '/zh/awakeners/leveling' },
                { text: '启灵系统', link: '/zh/awakeners/enlightenment' },
                { text: '阵容搭配', link: '/zh/awakeners/team-building' },
              ]
            }
          ],
          '/zh/cards/': [
            {
              text: '卡牌系统',
              items: [
                { text: '卡牌总览', link: '/zh/cards/' },
                { text: '卡牌列表', link: '/zh/cards/list' },
                { text: '卡牌升级', link: '/zh/cards/upgrade' },
                { text: '构筑指南', link: '/zh/cards/deckbuilding' },
              ]
            }
          ],
          '/zh/realms/': [
            {
              text: '界域系统',
              items: [
                { text: '界域总览', link: '/zh/realms/' },
                { text: '混沌 Chaos', link: '/zh/realms/chaos' },
                { text: '深海 Aequor', link: '/zh/realms/aequor' },
                { text: '血肉 Caro', link: '/zh/realms/caro' },
                { text: '超维 Ultra', link: '/zh/realms/ultra' },
              ]
            }
          ],
          '/zh/wheels/': [
            {
              text: '命轮',
              items: [
                { text: '命轮总览', link: '/zh/wheels/' },
                { text: '命轮列表', link: '/zh/wheels/list' },
              ]
            }
          ],
          '/zh/covenants/': [
            {
              text: '密契',
              items: [
                { text: '密契总览', link: '/zh/covenants/' },
                { text: '密契列表', link: '/zh/covenants/list' },
              ]
            }
          ],
          '/zh/key-orders/': [
            {
              text: '钥令',
              items: [
                { text: '钥令总览', link: '/zh/key-orders/' },
                { text: '钥令列表', link: '/zh/key-orders/list' },
              ]
            }
          ],
          '/zh/engravings/': [
            {
              text: '刻印',
              items: [
                { text: '刻印总览', link: '/zh/engravings/' },
                { text: '刻印列表', link: '/zh/engravings/list' },
              ]
            }
          ],
          '/zh/modes/': [
            {
              text: '游戏模式',
              items: [
                { text: '模式总览', link: '/zh/modes/' },
                { text: '战斗系统', link: '/zh/modes/combat' },
                { text: '调查行动', link: '/zh/modes/investigation' },
                { text: '相位对弈', link: '/zh/modes/phase-chess' },
                { text: '意识潜游', link: '/zh/modes/consciousness-dive' },
                { text: '异梦视界', link: '/zh/modes/dream-visions' },
                { text: '繁衍狂热', link: '/zh/modes/proliferation' },
                { text: '召唤系统', link: '/zh/modes/gacha' },
                { text: '冶炼室', link: '/zh/modes/smelting' },
                { text: '派遣', link: '/zh/modes/dispatch' },
              ]
            }
          ],
          '/zh/stages/': [
            {
              text: '关卡攻略',
              items: [
                { text: '关卡总览', link: '/zh/stages/' },
                { text: '主线关卡', link: '/zh/stages/main' },
                { text: '资源关卡', link: '/zh/stages/resource' },
                { text: '挑战关卡', link: '/zh/stages/challenge' },
              ]
            }
          ],
          '/zh/story/': [
            {
              text: '剧情与世界观',
              items: [
                { text: '剧情总览', link: '/zh/story/' },
                { text: '主线剧情', link: '/zh/story/main' },
                { text: '角色故事', link: '/zh/story/character-stories' },
                { text: '世界观设定', link: '/zh/story/worldbuilding' },
                { text: '银芯通信', link: '/zh/story/silver-core' },
              ]
            }
          ],
          '/zh/items/': [
            {
              text: '道具一览',
              items: [
                { text: '道具总览', link: '/zh/items/' },
                { text: '材料', link: '/zh/items/materials' },
                { text: '造物', link: '/zh/items/creations' },
                { text: '物资与货币', link: '/zh/items/currency' },
              ]
            }
          ],
          '/zh/events/': [
            {
              text: '活动记录',
              items: [
                { text: '活动总览', link: '/zh/events/' },
                { text: '当前活动', link: '/zh/events/current' },
                { text: '历史活动', link: '/zh/events/history' },
                { text: '联动活动', link: '/zh/events/collab' },
              ]
            }
          ],
          '/zh/guides/': [
            {
              text: '攻略指南',
              items: [
                { text: '攻略总览', link: '/zh/guides/' },
                { text: '新手指南', link: '/zh/guides/beginner' },
                { text: '日常任务', link: '/zh/guides/dailies' },
                { text: '节奏榜', link: '/zh/guides/tier-list' },
                { text: '常见问题', link: '/zh/guides/faq' },
              ]
            }
          ],
        },
        outline: { label: '本页目录' },
        docFooter: { prev: '上一篇', next: '下一篇' },
        lastUpdated: { text: '最后更新' },
        editLink: { pattern: 'https://github.com/lightproud/brain-in-a-vat/edit/main/projects/wiki/docs/:path', text: '在 GitHub 上编辑此页' },
        search: { provider: 'local' },
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          {
            text: 'Database',
            items: [
              { text: 'Awakeners', link: '/en/awakeners/' },
              { text: 'Cards', link: '/en/cards/' },
              { text: 'Realms', link: '/en/realms/' },
            ]
          },
          {
            text: 'Equipment',
            items: [
              { text: 'Wheels of Destiny', link: '/en/wheels/' },
              { text: 'Covenants', link: '/en/covenants/' },
              { text: 'Key Orders', link: '/en/key-orders/' },
              { text: 'Engravings', link: '/en/engravings/' },
            ]
          },
          {
            text: 'Gameplay',
            items: [
              { text: 'Game Modes', link: '/en/modes/' },
              { text: 'Stages', link: '/en/stages/' },
              { text: 'Story', link: '/en/story/' },
            ]
          },
          { text: 'Items', link: '/en/items/' },
          { text: 'Events', link: '/en/events/' },
          { text: 'Guides', link: '/en/guides/' },
          { text: 'Changelog', link: '/en/changelog' },
        ],
        sidebar: {
          '/en/awakeners/': [
            {
              text: 'Awakener Database',
              items: [
                { text: 'Overview', link: '/en/awakeners/' },
                { text: 'Awakener List', link: '/en/awakeners/list' },
                { text: 'Leveling Guide', link: '/en/awakeners/leveling' },
                { text: 'Enlightenment', link: '/en/awakeners/enlightenment' },
                { text: 'Team Building', link: '/en/awakeners/team-building' },
              ]
            }
          ],
          '/en/cards/': [
            {
              text: 'Card System',
              items: [
                { text: 'Overview', link: '/en/cards/' },
                { text: 'Card List', link: '/en/cards/list' },
                { text: 'Card Upgrades', link: '/en/cards/upgrade' },
                { text: 'Deckbuilding Guide', link: '/en/cards/deckbuilding' },
              ]
            }
          ],
          '/en/realms/': [
            {
              text: 'Designated Realms',
              items: [
                { text: 'Overview', link: '/en/realms/' },
                { text: 'Chaos', link: '/en/realms/chaos' },
                { text: 'Aequor', link: '/en/realms/aequor' },
                { text: 'Caro', link: '/en/realms/caro' },
                { text: 'Ultra', link: '/en/realms/ultra' },
              ]
            }
          ],
          '/en/wheels/': [{ text: 'Wheels of Destiny', items: [{ text: 'Overview', link: '/en/wheels/' }, { text: 'List', link: '/en/wheels/list' }] }],
          '/en/covenants/': [{ text: 'Covenants', items: [{ text: 'Overview', link: '/en/covenants/' }, { text: 'List', link: '/en/covenants/list' }] }],
          '/en/key-orders/': [{ text: 'Key Orders', items: [{ text: 'Overview', link: '/en/key-orders/' }, { text: 'List', link: '/en/key-orders/list' }] }],
          '/en/engravings/': [{ text: 'Engravings', items: [{ text: 'Overview', link: '/en/engravings/' }, { text: 'List', link: '/en/engravings/list' }] }],
          '/en/modes/': [
            {
              text: 'Game Modes',
              items: [
                { text: 'Overview', link: '/en/modes/' },
                { text: 'Combat System', link: '/en/modes/combat' },
                { text: 'Investigation', link: '/en/modes/investigation' },
                { text: 'Phase Chess (PvP)', link: '/en/modes/phase-chess' },
                { text: 'Consciousness Dive', link: '/en/modes/consciousness-dive' },
                { text: 'Dream Visions', link: '/en/modes/dream-visions' },
                { text: 'Proliferation Frenzy', link: '/en/modes/proliferation' },
                { text: 'Summoning (Gacha)', link: '/en/modes/gacha' },
                { text: 'Smelting Room', link: '/en/modes/smelting' },
                { text: 'Dispatch', link: '/en/modes/dispatch' },
              ]
            }
          ],
          '/en/stages/': [{ text: 'Stages', items: [{ text: 'Overview', link: '/en/stages/' }, { text: 'Main Stages', link: '/en/stages/main' }, { text: 'Resource Stages', link: '/en/stages/resource' }, { text: 'Challenge', link: '/en/stages/challenge' }] }],
          '/en/story/': [{ text: 'Story & Lore', items: [{ text: 'Overview', link: '/en/story/' }, { text: 'Main Story', link: '/en/story/main' }, { text: 'Character Stories', link: '/en/story/character-stories' }, { text: 'Worldbuilding', link: '/en/story/worldbuilding' }, { text: 'Silver Core', link: '/en/story/silver-core' }] }],
          '/en/items/': [{ text: 'Items', items: [{ text: 'Overview', link: '/en/items/' }, { text: 'Materials', link: '/en/items/materials' }, { text: 'Creations', link: '/en/items/creations' }, { text: 'Currency', link: '/en/items/currency' }] }],
          '/en/events/': [{ text: 'Events', items: [{ text: 'Overview', link: '/en/events/' }, { text: 'Current', link: '/en/events/current' }, { text: 'History', link: '/en/events/history' }, { text: 'Collaborations', link: '/en/events/collab' }] }],
          '/en/guides/': [{ text: 'Guides', items: [{ text: 'Overview', link: '/en/guides/' }, { text: 'Beginner Guide', link: '/en/guides/beginner' }, { text: 'Daily Tasks', link: '/en/guides/dailies' }, { text: 'Tier List', link: '/en/guides/tier-list' }, { text: 'FAQ', link: '/en/guides/faq' }] }],
        },
        editLink: { pattern: 'https://github.com/lightproud/brain-in-a-vat/edit/main/projects/wiki/docs/:path', text: 'Edit this page on GitHub' },
        search: { provider: 'local' },
      }
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      link: '/ja/',
      themeConfig: {
        nav: [
          { text: 'ホーム', link: '/ja/' },
          {
            text: '図鑑',
            items: [
              { text: '覚醒体', link: '/ja/awakeners/' },
              { text: 'カード', link: '/ja/cards/' },
              { text: '界域', link: '/ja/realms/' },
            ]
          },
          {
            text: '装備',
            items: [
              { text: '運命の輪', link: '/ja/wheels/' },
              { text: '密契', link: '/ja/covenants/' },
              { text: '鍵令', link: '/ja/key-orders/' },
              { text: '刻印', link: '/ja/engravings/' },
            ]
          },
          {
            text: 'ゲーム',
            items: [
              { text: 'ゲームモード', link: '/ja/modes/' },
              { text: 'ステージ', link: '/ja/stages/' },
              { text: 'ストーリー', link: '/ja/story/' },
            ]
          },
          { text: 'アイテム', link: '/ja/items/' },
          { text: 'イベント', link: '/ja/events/' },
          { text: '攻略', link: '/ja/guides/' },
        ],
        sidebar: {
          '/ja/awakeners/': [{ text: '覚醒体図鑑', items: [{ text: '概要', link: '/ja/awakeners/' }, { text: '覚醒体一覧', link: '/ja/awakeners/list' }, { text: '育成ガイド', link: '/ja/awakeners/leveling' }, { text: '啓霊', link: '/ja/awakeners/enlightenment' }, { text: '編成ガイド', link: '/ja/awakeners/team-building' }] }],
          '/ja/cards/': [{ text: 'カードシステム', items: [{ text: '概要', link: '/ja/cards/' }, { text: 'カード一覧', link: '/ja/cards/list' }, { text: 'カード強化', link: '/ja/cards/upgrade' }, { text: 'デッキ構築', link: '/ja/cards/deckbuilding' }] }],
          '/ja/realms/': [{ text: '界域システム', items: [{ text: '概要', link: '/ja/realms/' }, { text: '混沌 Chaos', link: '/ja/realms/chaos' }, { text: '深海 Aequor', link: '/ja/realms/aequor' }, { text: '血肉 Caro', link: '/ja/realms/caro' }, { text: '超維 Ultra', link: '/ja/realms/ultra' }] }],
          '/ja/wheels/': [{ text: '運命の輪', items: [{ text: '概要', link: '/ja/wheels/' }, { text: '一覧', link: '/ja/wheels/list' }] }],
          '/ja/covenants/': [{ text: '密契', items: [{ text: '概要', link: '/ja/covenants/' }, { text: '一覧', link: '/ja/covenants/list' }] }],
          '/ja/key-orders/': [{ text: '鍵令', items: [{ text: '概要', link: '/ja/key-orders/' }, { text: '一覧', link: '/ja/key-orders/list' }] }],
          '/ja/engravings/': [{ text: '刻印', items: [{ text: '概要', link: '/ja/engravings/' }, { text: '一覧', link: '/ja/engravings/list' }] }],
          '/ja/modes/': [{ text: 'ゲームモード', items: [{ text: '概要', link: '/ja/modes/' }, { text: '戦闘システム', link: '/ja/modes/combat' }, { text: '調査行動', link: '/ja/modes/investigation' }, { text: '相位対局（PvP）', link: '/ja/modes/phase-chess' }, { text: '意識潜游', link: '/ja/modes/consciousness-dive' }, { text: '異夢視界', link: '/ja/modes/dream-visions' }, { text: '繁殖狂乱', link: '/ja/modes/proliferation' }, { text: '召喚', link: '/ja/modes/gacha' }, { text: '冶錬室', link: '/ja/modes/smelting' }, { text: '派遣', link: '/ja/modes/dispatch' }] }],
          '/ja/stages/': [{ text: 'ステージ', items: [{ text: '概要', link: '/ja/stages/' }, { text: 'メイン', link: '/ja/stages/main' }, { text: '素材', link: '/ja/stages/resource' }, { text: 'チャレンジ', link: '/ja/stages/challenge' }] }],
          '/ja/story/': [{ text: 'ストーリー', items: [{ text: '概要', link: '/ja/story/' }, { text: 'メインストーリー', link: '/ja/story/main' }, { text: 'キャラストーリー', link: '/ja/story/character-stories' }, { text: '世界観', link: '/ja/story/worldbuilding' }, { text: '銀芯通信', link: '/ja/story/silver-core' }] }],
          '/ja/items/': [{ text: 'アイテム', items: [{ text: '概要', link: '/ja/items/' }, { text: '素材', link: '/ja/items/materials' }, { text: '造物', link: '/ja/items/creations' }, { text: '通貨', link: '/ja/items/currency' }] }],
          '/ja/events/': [{ text: 'イベント', items: [{ text: '概要', link: '/ja/events/' }, { text: '開催中', link: '/ja/events/current' }, { text: '過去', link: '/ja/events/history' }, { text: 'コラボ', link: '/ja/events/collab' }] }],
          '/ja/guides/': [{ text: '攻略', items: [{ text: '概要', link: '/ja/guides/' }, { text: '初心者ガイド', link: '/ja/guides/beginner' }, { text: 'デイリー', link: '/ja/guides/dailies' }, { text: 'Tier表', link: '/ja/guides/tier-list' }, { text: 'FAQ', link: '/ja/guides/faq' }] }],
        },
        outline: { label: '目次' },
        docFooter: { prev: '前へ', next: '次へ' },
        lastUpdated: { text: '最終更新' },
        editLink: { pattern: 'https://github.com/lightproud/brain-in-a-vat/edit/main/projects/wiki/docs/:path', text: 'GitHub でこのページを編集' },
        search: { provider: 'local' },
      }
    },
  },

  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/lightproud/brain-in-a-vat' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: '忘却前夜 (Morimens) 非官方Wiki - 游戏内容版权归 B.I.A.V. Studio / 灵犀互娱 所有',
      copyright: 'Wiki Content © 2024-2026 Morimens Wiki Contributors',
    },
  },

  lastUpdated: true,
  cleanUrls: true,
})

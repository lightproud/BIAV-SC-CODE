import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '忘却前夜 Wiki',
  description: '忘却前夜 (Morimens) 游戏资料站 - 基于客户端数据提取',

  base: '/brain-in-a-vat/wiki/',
  ignoreDeadLinks: true,
  lang: 'zh-CN',

  head: [
    ['meta', { name: 'keywords', content: '忘却前夜,Morimens,wiki,收藏馆,语音,CG,命轮,密契,克苏鲁,roguelite' }],
    ['meta', { name: 'theme-color', content: '#c5a356' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/brain-in-a-vat/wiki/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '语音台词', link: '/voice-lines' },
      { text: '收藏馆', link: '/collection-hall' },
      { text: 'CG 画廊', link: '/cg-gallery' },
      { text: '道具故事', link: '/item-stories' },
    ],
    sidebar: [
      {
        text: '客户端数据',
        items: [
          { text: '语音台词', link: '/voice-lines' },
          { text: '收藏馆百科', link: '/collection-hall' },
          { text: 'CG 画廊', link: '/cg-gallery' },
          { text: '道具背景故事', link: '/item-stories' },
        ]
      }
    ],
    outline: { label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/lightproud/brain-in-a-vat' },
    ],
    search: { provider: 'local' },
    footer: {
      message: '忘却前夜 (Morimens) 非官方 Wiki - 数据来源: 客户端 Lua 提取 + 美术资产解包',
      copyright: 'Wiki Content (c) 2024-2026 B.I.A.V. Studio',
    },
  },

  lastUpdated: true,
  cleanUrls: false,
  appearance: 'force-dark',
})

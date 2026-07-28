import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '忘却前夜 Wiki',
  description: '忘却前夜 (Morimens) 游戏资料站 - 基于客户端数据提取',

  base: '/BIAV-SC-CODE/wiki/',
  ignoreDeadLinks: true,
  lang: 'zh-CN',

  // docs/public/data 是指向 projects/wiki/data 的符号链接（供站点直取 JSON 数据集）。
  // VitePress 的页面 glob 会跟随该链接，把数据层里的 README / TODO / RESEARCH_NOTES /
  // STORY_RESEARCH / character_skills 六份**内部工作档**当成源页面编译，产出
  // dist/public/data/processed/*.html 六张无人导航的孤儿页（且其中的相对链接失效，
  // 全靠 ignoreDeadLinks 压着不报）。public/ 只应作静态资产目录，永不作页面源。
  srcExclude: ['public/**'],

  head: [
    ['meta', { name: 'keywords', content: '忘却前夜,Morimens,wiki,收藏馆,语音,CG,命轮,密契,克苏鲁,roguelite' }],
    ['meta', { name: 'theme-color', content: '#c5a356' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/BIAV-SC-CODE/wiki/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      {
        text: '角色',
        items: [
          { text: '唤醒体图鉴', link: '/characters' },
          { text: '唤醒体列表', link: '/zh/awakeners/' },
          { text: '玩法图鉴', link: '/playstyle' },
          { text: '语音台词', link: '/voice-lines' },
          { text: '角色立绘', link: '/portraits' },
        ]
      },
      {
        text: '系统',
        items: [
          { text: '战斗机制', link: '/battle-system' },
          { text: '启灵效果词条', link: '/potency' },
          { text: '唤醒系统', link: '/summon' },
          { text: '关卡导航', link: '/stages' },
          { text: '收藏馆', link: '/collection-hall' },
        ]
      },
      {
        text: '世界观',
        items: [
          { text: '剧情正文读本', link: '/story' },
          { text: '剧情考据', link: '/lore-research' },
          { text: 'CG 画廊', link: '/cg-gallery' },
          { text: '道具故事', link: '/item-stories' },
          { text: '过场视频', link: '/video' },
        ]
      },
      {
        text: '资产库',
        items: [
          { text: '战斗单位', link: '/battle-units' },
          { text: '图标', link: '/icons' },
          { text: 'UI 资源', link: '/ui-resources' },
          { text: '音频', link: '/audio' },
        ]
      },
      {
        text: '更多',
        items: [
          { text: '功能解锁条件', link: '/feature-unlock' },
          { text: '面板文本', link: '/panel-text' },
        ]
      },
    ],
    sidebar: {
      '/': [
        {
          text: '角色',
          items: [
            { text: '唤醒体图鉴', link: '/characters' },
            { text: '唤醒体列表', link: '/zh/awakeners/' },
            { text: '玩法图鉴', link: '/playstyle' },
            { text: '语音台词', link: '/voice-lines' },
            { text: '角色立绘', link: '/portraits' },
          ]
        },
        {
          text: '系统',
          items: [
            { text: '战斗机制', link: '/battle-system' },
            { text: '启灵效果词条', link: '/potency' },
            { text: '唤醒系统', link: '/summon' },
            { text: '关卡导航', link: '/stages' },
            { text: '收藏馆', link: '/collection-hall' },
          ]
        },
        {
          text: '世界观',
          items: [
            { text: '剧情正文读本', link: '/story' },
            { text: '剧情考据', link: '/lore-research' },
            { text: 'CG 画廊', link: '/cg-gallery' },
            { text: '道具故事', link: '/item-stories' },
            { text: '过场视频', link: '/video' },
          ]
        },
        {
          text: '资产库',
          items: [
            { text: '战斗单位', link: '/battle-units' },
            { text: '图标', link: '/icons' },
            { text: 'UI 资源', link: '/ui-resources' },
            { text: '音频', link: '/audio' },
          ]
        },
        {
          text: '更多',
          collapsed: true,
          items: [
            { text: '功能解锁条件', link: '/feature-unlock' },
            { text: '面板文本', link: '/panel-text' },
            ]
        },
      ],
    },
    outline: { label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/lightproud/BIAV-SC-CODE' },
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

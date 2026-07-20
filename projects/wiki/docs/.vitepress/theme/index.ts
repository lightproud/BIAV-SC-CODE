import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './morimens-design-tokens.css'
import './morimens-vitepress-theme.css'

import CharacterSheet from './components/CharacterSheet.vue'
import CharacterInfobox from './components/CharacterInfobox.vue'
import CharacterGrid from './components/CharacterGrid.vue'
import SkillTable from './components/SkillTable.vue'
import AscensionMaterialBlock from './components/AscensionMaterialBlock.vue'
import TrinketRecommendationCard from './components/TrinketRecommendationCard.vue'
import BondRewardList from './components/BondRewardList.vue'
import StatGrowthChart from './components/StatGrowthChart.vue'
import AffinityTags from './components/AffinityTags.vue'
import VoiceLineList from './components/VoiceLineList.vue'
import PortraitGallery from './components/PortraitGallery.vue'
import FixtureBadge from './components/FixtureBadge.vue'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CharacterSheet', CharacterSheet)
    app.component('CharacterInfobox', CharacterInfobox)
    app.component('CharacterGrid', CharacterGrid)
    app.component('SkillTable', SkillTable)
    app.component('AscensionMaterialBlock', AscensionMaterialBlock)
    app.component('TrinketRecommendationCard', TrinketRecommendationCard)
    app.component('BondRewardList', BondRewardList)
    app.component('StatGrowthChart', StatGrowthChart)
    app.component('AffinityTags', AffinityTags)
    app.component('VoiceLineList', VoiceLineList)
    app.component('PortraitGallery', PortraitGallery)
    app.component('FixtureBadge', FixtureBadge)
  },
}

export default theme

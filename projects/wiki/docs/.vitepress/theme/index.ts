import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './custom.css'

import CharacterGrid from './components/CharacterGrid.vue'
import CharacterCompare from './components/CharacterCompare.vue'
import WheelList from './components/WheelList.vue'
import GachaSimulator from './components/GachaSimulator.vue'
import TeamBuilder from './components/TeamBuilder.vue'
import UpdateTimeline from './components/UpdateTimeline.vue'
import ChangelogFeed from './components/ChangelogFeed.vue'
import FarmingPlanner from './components/FarmingPlanner.vue'
import DamageCalculator from './components/DamageCalculator.vue'
import StaminaTracker from './components/StaminaTracker.vue'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CharacterGrid', CharacterGrid)
    app.component('CharacterCompare', CharacterCompare)
    app.component('WheelList', WheelList)
    app.component('GachaSimulator', GachaSimulator)
    app.component('TeamBuilder', TeamBuilder)
    app.component('UpdateTimeline', UpdateTimeline)
    app.component('ChangelogFeed', ChangelogFeed)
    app.component('FarmingPlanner', FarmingPlanner)
    app.component('DamageCalculator', DamageCalculator)
    app.component('StaminaTracker', StaminaTracker)
  },
}

export default theme

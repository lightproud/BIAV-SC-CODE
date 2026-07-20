<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()

const skills = computed(() => {
  const s = props.character.skills
  return typeof s === 'object' ? (s as Record<string, any>) : null
})
</script>

<template>
  <section class="m-skills" v-if="skills">
    <h2 class="m-skills__h2">技能与战斗机制</h2>

    <div v-if="skills.command_cards?.length" class="m-skills__block">
      <h3 class="m-skills__h3">指令卡 (Command Cards)</h3>
      <p v-if="skills.command_cards_note" class="m-skills__note">{{ skills.command_cards_note }}</p>
      <table class="m-skills__table">
        <thead>
          <tr><th>名称</th><th>消耗</th><th>效果</th></tr>
        </thead>
        <tbody>
          <tr v-for="card in skills.command_cards" :key="card.name">
            <td>
              <strong>{{ card.name }}</strong>
              <span v-if="card.name_en" class="m-skills__name-en">{{ card.name_en }}</span>
            </td>
            <td class="m-skills__num">{{ card.cost ?? '—' }}</td>
            <td>
              {{ card.effect }}
              <ul v-if="card.upgrades?.length" class="m-skills__upgrades">
                <li v-for="u in card.upgrades" :key="u.name"><em>{{ u.name }}</em>：{{ u.effect }}</li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-for="key in ['rouse', 'exalt', 'overexalt', 'talent']" :key="key" class="m-skills__block">
      <template v-if="skills[key]">
        <h3 class="m-skills__h3">{{ ({ rouse: '灵知觉醒', exalt: '高华', overexalt: '超华', talent: '天赋' } as Record<string, string>)[key] }}</h3>
        <div class="m-skills__entry">
          <header class="m-skills__entry-head">
            <strong>{{ skills[key].name }}</strong>
            <span v-if="skills[key].name_en" class="m-skills__name-en">{{ skills[key].name_en }}</span>
            <span v-if="skills[key].cost !== undefined" class="m-skills__chip">消耗 {{ skills[key].cost }}</span>
            <span v-if="skills[key].charge !== undefined" class="m-skills__chip">充能 {{ skills[key].charge }}</span>
            <span v-if="skills[key].cooldown !== undefined" class="m-skills__chip">冷却 {{ skills[key].cooldown }}</span>
          </header>
          <p>{{ skills[key].effect }}</p>
          <p v-if="skills[key].note" class="m-skills__note">{{ skills[key].note }}</p>
        </div>
      </template>
    </div>

    <div v-if="skills.enlighten?.length" class="m-skills__block">
      <h3 class="m-skills__h3">启示 (Enlighten)</h3>
      <table class="m-skills__table">
        <thead><tr><th>等级</th><th>名称</th><th>效果</th></tr></thead>
        <tbody>
          <tr v-for="ent in skills.enlighten" :key="ent.level">
            <td class="m-skills__num">Lv.{{ ent.level }}</td>
            <td>
              <strong>{{ ent.name }}</strong>
              <span v-if="ent.name_en" class="m-skills__name-en">{{ ent.name_en }}</span>
            </td>
            <td>{{ ent.effect }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="skills.special_mechanic" class="m-skills__block m-skills__block--mechanic">
      <h3 class="m-skills__h3">特殊机制</h3>
      <template v-if="typeof skills.special_mechanic === 'string'">
        <p>{{ skills.special_mechanic }}</p>
      </template>
      <template v-else>
        <p>
          <strong>{{ skills.special_mechanic.name }}</strong>
          <span v-if="skills.special_mechanic.name_en" class="m-skills__name-en">{{ skills.special_mechanic.name_en }}</span>
        </p>
        <p>{{ skills.special_mechanic.description }}</p>
      </template>
    </div>

    <div v-if="skills.role_in_team || skills.build_notes" class="m-skills__block">
      <h3 class="m-skills__h3">配队与构筑</h3>
      <p v-if="skills.role_in_team"><strong>定位：</strong>{{ skills.role_in_team }}</p>
      <p v-if="typeof skills.build_notes === 'string'"><strong>构筑要点：</strong>{{ skills.build_notes }}</p>
      <ul v-else-if="skills.build_notes && typeof skills.build_notes === 'object'">
        <li v-for="(val, key) in skills.build_notes" :key="key"><strong>{{ key }}：</strong>{{ val }}</li>
      </ul>
    </div>
  </section>
  <section v-else-if="character.skills === 'pending'" class="m-skills m-skills--pending">
    <h2 class="m-skills__h2">技能与战斗机制</h2>
    <p class="m-skills__pending">技能数据待 Phase 2 / Phase 3 补齐。</p>
  </section>
</template>

<style scoped>
.m-skills { margin-bottom: var(--m-sp-10); }
.m-skills__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-skills__block { margin-bottom: var(--m-sp-8); }
.m-skills__h3 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h2);
  color: var(--m-gold-primary);
  margin: 0 0 var(--m-sp-3);
}
.m-skills__note {
  font-size: var(--m-fs-caption);
  color: var(--m-text-dim);
  margin: var(--m-sp-2) 0;
  font-style: italic;
}
.m-skills__table {
  width: 100%;
  border-collapse: collapse;
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  overflow: hidden;
}
.m-skills__table th {
  background: var(--m-bg-card);
  color: var(--m-gold-light);
  font-family: var(--m-font-title);
  font-size: var(--m-fs-caption);
  letter-spacing: var(--m-ls-caps);
  text-align: left;
  padding: var(--m-sp-3) var(--m-sp-4);
  border-bottom: 1px solid var(--m-border-default);
}
.m-skills__table td {
  padding: var(--m-sp-3) var(--m-sp-4);
  border-bottom: 1px solid var(--m-border-subtle);
  vertical-align: top;
  color: var(--m-text-primary);
  font-size: var(--m-fs-body);
}
.m-skills__table tr:nth-child(even) td { background: rgba(197, 163, 86, 0.03); }
.m-skills__table tr:last-child td { border-bottom: 0; }
.m-skills__num { font-family: var(--m-font-code); color: var(--m-gold-light); white-space: nowrap; }
.m-skills__name-en {
  display: block;
  font-size: var(--m-fs-small);
  color: var(--m-text-dim);
  letter-spacing: var(--m-ls-title);
  margin-top: 2px;
}
.m-skills__upgrades {
  margin: var(--m-sp-2) 0 0;
  padding-left: var(--m-sp-4);
  font-size: var(--m-fs-caption);
  color: var(--m-text-muted);
}
.m-skills__entry {
  background: var(--m-bg-elevated);
  padding: var(--m-sp-4);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
}
.m-skills__entry-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--m-sp-2);
  align-items: baseline;
  margin-bottom: var(--m-sp-3);
}
.m-skills__entry-head strong {
  color: var(--m-gold-light);
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h3);
}
.m-skills__chip {
  background: var(--m-bg-card);
  color: var(--m-gold-light);
  padding: 2px var(--m-sp-2);
  border-radius: var(--m-radius-sm);
  font-size: var(--m-fs-small);
  letter-spacing: var(--m-ls-caps);
  font-family: var(--m-font-code);
}
.m-skills__block--mechanic {
  background: rgba(197, 163, 86, 0.04);
  padding: var(--m-sp-4);
  border-left: 2px solid var(--m-gold-primary);
  border-radius: var(--m-radius-sm);
}
.m-skills--pending .m-skills__pending {
  color: var(--m-text-dim);
  font-style: italic;
  padding: var(--m-sp-4);
  background: var(--m-bg-elevated);
  border-radius: var(--m-radius-md);
  border: 1px dashed var(--m-border-subtle);
}
</style>

<script setup lang="ts">
import type { Certainty, PlacePair } from '../../types/placePair'
import { splitHighlight } from '../../hooks/usePlaceSearch'

const props = withDefaults(
  defineProps<{
    pair: PlacePair
    query?: string
    sheetCode?: string
  }>(),
  {
    query: '',
    sheetCode: '',
  },
)

const certaintyType: Record<Certainty, 'success' | 'warning' | 'danger'> = {
  确定: 'success',
  存疑: 'warning',
  待考: 'danger',
}

function highlight(text: string) {
  return splitHighlight(text, props.query)
}
</script>

<template>
  <article class="pair-row">
    <div class="pair-row__names">
      <div class="pair-row__name-block">
        <span class="pair-row__label">图上旧名</span>
        <strong class="pair-row__name">
          <template v-for="(part, index) in highlight(pair.oldName)" :key="`old-${index}`">
            <mark v-if="part.matched">{{ part.text }}</mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </strong>
      </div>
      <span class="pair-row__arrow" aria-hidden="true">→</span>
      <div class="pair-row__name-block">
        <span class="pair-row__label">今地名</span>
        <strong class="pair-row__name pair-row__name--new">
          <template v-for="(part, index) in highlight(pair.newName)" :key="`new-${index}`">
            <mark v-if="part.matched">{{ part.text }}</mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </strong>
      </div>
    </div>
    <div class="pair-row__tags">
      <el-tag effect="plain">{{ pair.placeType }}</el-tag>
      <el-tag :type="certaintyType[pair.certainty]">{{ pair.certainty }}</el-tag>
      <el-tag v-if="sheetCode" type="info" effect="plain">{{ sheetCode }}</el-tag>
    </div>
    <p class="pair-row__coord">
      <span class="pair-row__label">图上方位</span>
      <template v-for="(part, index) in highlight(pair.coordNote)" :key="`coord-${index}`">
        <mark v-if="part.matched">{{ part.text }}</mark>
        <span v-else>{{ part.text }}</span>
      </template>
    </p>
    <p v-if="pair.aliasList.length" class="pair-row__aliases">
      异写异读：
      <template v-for="(alias, aliasIndex) in pair.aliasList" :key="alias">
        <span>
          <template v-for="(part, partIndex) in highlight(alias)" :key="`alias-${aliasIndex}-${partIndex}`">
            <mark v-if="part.matched">{{ part.text }}</mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </span><span v-if="aliasIndex < pair.aliasList.length - 1">、</span>
      </template>
    </p>
  </article>
</template>

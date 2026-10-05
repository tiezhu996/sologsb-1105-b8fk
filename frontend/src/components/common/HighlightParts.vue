<script setup lang="ts">
import type { HighlightPart } from '../../types/search'

defineProps<{
  parts: HighlightPart[]
}>()
</script>

<template>
  <span class="highlight-parts">
    <template v-for="(part, index) in parts" :key="index">
      <mark v-if="part.matched">{{ part.text }}</mark>
      <span v-else>{{ part.text }}</span>
    </template>
  </span>
</template>

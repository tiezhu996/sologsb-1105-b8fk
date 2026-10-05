<script setup lang="ts">
import type { SheetScale } from '../../types/sheet'

defineProps<{
  year: number
  scale: SheetScale
}>()
</script>

<template>
  <div class="scale-tag-group" aria-label="图幅比例尺与年代">
    <el-tag type="warning" effect="plain">{{ year }} 年</el-tag>
    <el-tag type="info" effect="plain">{{ scale }}</el-tag>
  </div>
</template>

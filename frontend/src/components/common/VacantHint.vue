<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    description: string
    actionText?: string
  }>(),
  {
    actionText: '',
  },
)

defineEmits<{
  action: []
}>()
</script>

<template>
  <div class="vacant-hint">
    <div class="vacant-hint__mark" aria-hidden="true">
      <svg viewBox="0 0 80 64" role="img">
        <path d="M7 51h20V35h10v16h15V22h10v29h11" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
        <path d="M9 17l18-8 16 9 28-9v37l-28 9-16-9-18 8z" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M27 9v37M43 18v37" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4" />
      </svg>
    </div>
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
    <el-button v-if="actionText" type="primary" plain @click="$emit('action')">{{ actionText }}</el-button>
  </div>
</template>

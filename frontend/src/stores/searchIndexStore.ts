import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { IndexMeta } from '../types/search'
import {
  bootIndex,
  cancelBuild,
  getIndexMeta,
  onIndexEvent,
  rebuild,
  resumeBuild,
  verifyIndex,
} from '../utils/searchIndexer'

/**
 * 检索索引的生命周期状态。
 * 检索结果本身不保存在这里（由各检索 composable 持有快照），这里只负责
 * 建立 / 续做 / 取消 / 校验，以及把索引器事件同步为响应式状态。
 */
export const useSearchIndexStore = defineStore('search-index', () => {
  const meta = ref<IndexMeta | null>(null)
  const booted = ref(false)
  const pumping = ref(false)

  const phase = computed(() => meta.value?.phase ?? 'building')
  const ready = computed(() => meta.value?.phase === 'idle')
  const stage = computed(() => meta.value?.stage ?? 'sheets')
  const docsRev = computed(() => meta.value?.docsRev ?? 0)

  const processedCount = computed(() => {
    const current = meta.value
    if (!current) {
      return 0
    }
    return current.indexedSheets + current.indexedPlaces
  })

  const progressPercent = computed(() => {
    const current = meta.value
    if (!current || current.totalSource <= 0) {
      return 0
    }
    return Math.min(100, Math.round((processedCount.value / current.totalSource) * 100))
  })

  function sync(next: IndexMeta): void {
    meta.value = next
  }

  async function boot(): Promise<void> {
    if (booted.value) {
      return
    }
    booted.value = true
    onIndexEvent((event) => {
      sync(event.meta)
      if (event.type === 'pump-start') {
        pumping.value = true
      }
      if (event.type === 'pump-done') {
        pumping.value = false
      }
    })
    sync(await getIndexMeta())
    sync(await bootIndex())
  }

  async function rebuildFromScratch(): Promise<void> {
    pumping.value = false
    sync(await rebuild())
  }

  async function resume(): Promise<void> {
    sync(await resumeBuild())
  }

  async function cancel(): Promise<void> {
    await cancelBuild()
  }

  async function verify(): Promise<{ ok: boolean; reason?: string }> {
    return verifyIndex()
  }

  return {
    meta,
    booted,
    pumping,
    phase,
    ready,
    stage,
    docsRev,
    processedCount,
    progressPercent,
    boot,
    rebuildFromScratch,
    resume,
    cancel,
    verify,
  }
})

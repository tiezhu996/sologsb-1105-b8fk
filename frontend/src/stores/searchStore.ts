import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SearchSnapshot } from '../types/search'
import {
  cancelIndexBuild,
  ensureIndex,
  indexerStatus,
  onIndexerEvent,
  rebuildIndex,
  search,
} from '../services/indexer'

const QUERY_DEBOUNCE_MS = 150

/**
 * 检索页状态。
 *
 * snapshot 永远是「上一份完整结果」：新查询或索引变更只会先把
 * refreshing 置为更新中，等整份结果在同一个一致快照里算完后
 * 才整体替换，页面不会混入新旧条目。索引重建期间 search 返回
 * null，旧快照继续保留展示。
 */
export const useSearchStore = defineStore('search', () => {
  const keyword = ref('')
  const snapshot = ref<SearchSnapshot | null>(null)
  const refreshing = ref(false)

  let querySeq = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function runQuery(): Promise<void> {
    const query = keyword.value.trim()
    const seq = (querySeq += 1)
    if (!query) {
      snapshot.value = null
      refreshing.value = false
      return
    }
    refreshing.value = true
    try {
      const result = await search(query)
      if (seq !== querySeq) {
        return
      }
      if (result) {
        snapshot.value = result
        refreshing.value = false
      }
      // result 为 null：索引重建中，保留旧快照并维持更新中标记
    } catch (error) {
      console.error('[search] 查询失败', error)
      if (seq === querySeq) {
        refreshing.value = false
      }
    }
  }

  function scheduleQuery(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      void runQuery()
    }, QUERY_DEBOUNCE_MS)
  }

  watch(keyword, scheduleQuery)

  // 索引每提交一批变更（或重建完成）就重算当前关键词；
  // 重算期间旧快照保留，直到新结果整份就绪
  onIndexerEvent('commit', () => {
    if (keyword.value.trim()) {
      void runQuery()
    }
  })
  onIndexerEvent('ready', () => {
    if (keyword.value.trim()) {
      void runQuery()
    }
  })

  const updating = computed(() => refreshing.value || indexerStatus.phase === 'building')

  return {
    keyword,
    snapshot,
    refreshing,
    updating,
    status: indexerStatus,
    ensureIndex,
    rebuildIndex,
    cancelIndexBuild,
  }
})

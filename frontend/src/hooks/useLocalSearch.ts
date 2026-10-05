import { computed, ref, watch, type MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'
import { useSearchIndexStore } from '../stores/searchIndexStore'
import type { SearchField, SearchHit, SearchRoot } from '../types/search'
import { searchPage } from '../utils/searchEngine'

export const SEARCH_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 180

export interface UseLocalSearchOptions {
  roots?: MaybeRefOrGetter<SearchRoot[]>
  fields?: MaybeRefOrGetter<SearchField[]>
}

/**
 * 本地综合检索。
 *
 * 快照语义：
 * - 索引更新（增量重算 / 分批重建）期间保留上一版完整结果，仅置「更新中」标记；
 * - 新结果整批原子替换，计算未完成时绝不把新旧条目混在一起；
 * - 初次建立且没有旧结果时，页面只显示建立进度，不展示半截列表。
 */
export function useLocalSearch(
  keyword: MaybeRefOrGetter<string>,
  options: UseLocalSearchOptions = {},
) {
  const indexStore = useSearchIndexStore()

  const hits = ref<SearchHit[]>([])
  const total = ref(0)
  const page = ref(1)
  const searching = ref(false)
  const hasSnapshot = ref(false)

  let activeController: AbortController | null = null
  let activeToken = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const updating = computed(
    () => !indexStore.ready || indexStore.pumping || indexStore.phase === 'building',
  )

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / SEARCH_PAGE_SIZE)))
  const usablePage = computed(() => Math.min(page.value, pageCount.value))

  function cancelPending(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (activeController) {
      activeController.abort()
      activeController = null
    }
  }

  async function runQuery(immediate = false): Promise<void> {
    if (!indexStore.ready) {
      // 索引不可用时不发起检索：页面保留上一份快照（若有），没有快照则等建立完成。
      return
    }
    cancelPending()
    // 当前页超出新结果的总页数时夹回末页，避免取到空页。
    if (page.value > pageCount.value) {
      page.value = pageCount.value
    }
    const execute = async () => {
      const token = ++activeToken
      const controller = new AbortController()
      activeController = controller
      searching.value = true
      try {
        const result = await searchPage(toValue(keyword), {
          roots: toValue(options.roots ?? []),
          fields: toValue(options.fields ?? []),
          limit: SEARCH_PAGE_SIZE,
          offset: (usablePage.value - 1) * SEARCH_PAGE_SIZE,
          signal: controller.signal,
        })
        if (token !== activeToken || controller.signal.aborted) {
          return
        }
        // 整批替换：旧快照保留到新结果就绪的这一帧，不逐行混入。
        hits.value = result.hits
        total.value = result.total
        hasSnapshot.value = true
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return
        }
        throw error
      } finally {
        if (token === activeToken) {
          searching.value = false
          activeController = null
        }
      }
    }

    if (immediate) {
      await execute()
    } else {
      debounceTimer = setTimeout(() => {
        void execute()
      }, SEARCH_DEBOUNCE_MS)
    }
  }

  function goPage(next: number): void {
    const target = Math.min(pageCount.value, Math.max(1, next))
    if (target === page.value) {
      return
    }
    page.value = target
    void runQuery()
  }

  // 关键词 / 过滤条件变化：回到第一页并防抖重检。
  watch(
    [() => toValue(keyword), () => toValue(options.roots ?? []), () => toValue(options.fields ?? [])],
    () => {
      if (!indexStore.ready) {
        return
      }
      page.value = 1
      void runQuery()
    },
    { deep: true },
  )

  // 索引恢复可用或一批受影响条目重算完成（docsRev 变化）后重检当前查询。
  watch(
    [() => indexStore.ready, () => indexStore.docsRev],
    ([readyNow], previous) => {
      const wasReady = previous?.[0] as boolean | undefined
      if (!readyNow) {
        return
      }
      if (wasReady === false || !hasSnapshot.value) {
        page.value = 1
      }
      void runQuery(true)
    },
    { immediate: true },
  )

  return {
    hits,
    total,
    page,
    pageCount,
    usablePage,
    searching,
    updating,
    hasSnapshot,
    goPage,
    refresh: () => runQuery(true),
  }
}

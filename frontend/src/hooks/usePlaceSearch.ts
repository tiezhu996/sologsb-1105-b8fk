import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useSearchIndexStore } from '../stores/searchIndexStore'
import type { PlacePair } from '../types/placePair'
import type { SearchField } from '../types/search'
import { searchMatchedSourceIds } from '../utils/searchEngine'

export interface HighlightPart {
  text: string
  matched: boolean
}

export interface PlaceSearchFieldMatch {
  field: '古名' | '今名' | '异写' | '图上方位'
  text: string
  parts: HighlightPart[]
}

export interface PlaceSearchHit {
  pair: PlacePair
  matches: PlaceSearchFieldMatch[]
}

/** 地名条目可沿关联链命中的字段：图幅号、古名、今名、异写、沿革、扫描件名、图上方位。 */
const PLACE_SEARCH_FIELDS: SearchField[] = [
  '图幅号',
  '古名',
  '今名',
  '异写',
  '沿革',
  '扫描件名',
  '图上方位',
]

export function splitHighlight(text: string, keyword: string): HighlightPart[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) {
    return [{ text, matched: false }]
  }

  const normalizedText = text.toLocaleLowerCase()
  const parts: HighlightPart[] = []
  let cursor = 0
  let matchIndex = normalizedText.indexOf(normalizedKeyword)

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), matched: false })
    }
    parts.push({
      text: text.slice(matchIndex, matchIndex + normalizedKeyword.length),
      matched: true,
    })
    cursor = matchIndex + normalizedKeyword.length
    matchIndex = normalizedText.indexOf(normalizedKeyword, cursor)
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), matched: false })
  }

  return parts.length > 0 ? parts : [{ text, matched: false }]
}

/**
 * 地名反向检索。
 *
 * 命中集合来自 IndexedDB 中的本地检索索引（沿图幅号、古名、今名、异写、沿革、
 * 扫描件名与图上方位的反规范化文档），由索引器在源数据变化时只重算受影响条目，
 * 这里不再对内存中的全部地名做全量扫描。
 *
 * 快照语义与综合检索一致：更新期间沿用上一份命中集合，重算完成后整批替换。
 */
export function usePlaceSearch(
  keyword: MaybeRefOrGetter<string>,
  pairs: MaybeRefOrGetter<PlacePair[]>,
) {
  const indexStore = useSearchIndexStore()

  const matchedIds = ref<Set<string>>(new Set())
  const hasSnapshot = ref(false)
  let token = 0

  const normalizedKeyword = computed(() => toValue(keyword).trim().toLocaleLowerCase())

  async function refresh(): Promise<void> {
    if (!indexStore.ready) {
      return
    }
    const currentToken = ++token
    const query = normalizedKeyword.value
    const next = query
      ? await searchMatchedSourceIds('place', query, { fields: PLACE_SEARCH_FIELDS })
      : new Set(toValue(pairs).map((pair) => pair.id))
    if (currentToken !== token) {
      return
    }
    matchedIds.value = next
    hasSnapshot.value = true
  }

  watch(
    [normalizedKeyword, () => toValue(pairs), () => indexStore.ready, () => indexStore.docsRev],
    () => {
      void refresh()
    },
    { immediate: true },
  )

  const hits = computed<PlaceSearchHit[]>(() => {
    const query = normalizedKeyword.value
    if (!query) {
      return []
    }
    const rows: PlaceSearchHit[] = []
    for (const pair of toValue(pairs)) {
      if (!matchedIds.value.has(pair.id)) {
        continue
      }
      const candidates: Array<{ field: PlaceSearchFieldMatch['field']; text: string }> = [
        { field: '古名', text: pair.oldName },
        { field: '今名', text: pair.newName },
        ...pair.aliasList.map((alias) => ({ field: '异写' as const, text: alias })),
        { field: '图上方位', text: pair.coordNote },
      ]
      const matches = candidates
        .filter((candidate) => candidate.text.toLocaleLowerCase().includes(query))
        .map((candidate) => ({
          ...candidate,
          parts: splitHighlight(candidate.text, toValue(keyword)),
        }))
      rows.push({ pair, matches })
    }
    return rows
  })

  function matches(pair: PlacePair): boolean {
    if (!normalizedKeyword.value) {
      return true
    }
    // 更新期间沿用上一份命中集合，保证列表不会混入尚未重算完的条目。
    return matchedIds.value.has(pair.id)
  }

  return {
    hits,
    matches,
    highlight: splitHighlight,
    ready: computed(() => indexStore.ready),
    updating: computed(() => !indexStore.ready || indexStore.pumping),
    hasSnapshot,
  }
}

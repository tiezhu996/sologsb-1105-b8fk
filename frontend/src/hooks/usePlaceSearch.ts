import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { PlacePair } from '../types/placePair'
import type { Sheet } from '../types/sheet'
import type { HighlightPart } from '../types/search'
import { splitHighlight } from '../utils/searchIndex'
import { usePlaceStore } from '../stores/placeStore'
import { useSheetStore } from '../stores/sheetStore'

export type { HighlightPart }
export { splitHighlight }

export interface PlaceSearchFieldMatch {
  field: '古名' | '今名' | '异写' | '图上方位'
  text: string
  parts: HighlightPart[]
}

export interface PlaceSearchHit {
  pair: PlacePair
  sheet?: Sheet
  matches: PlaceSearchFieldMatch[]
}

export function usePlaceSearch(keyword: MaybeRefOrGetter<string>) {
  const placeStore = usePlaceStore()
  const sheetStore = useSheetStore()

  const normalizedKeyword = computed(() => toValue(keyword).trim().toLocaleLowerCase())

  const hits = computed<PlaceSearchHit[]>(() => {
    const query = normalizedKeyword.value
    if (!query) {
      return []
    }

    return placeStore.pairs.flatMap((pair) => {
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

      if (matches.length === 0) {
        return []
      }

      const sheet = sheetStore.sheets.find((item) => item.id === pair.sheetId)
      return [{ pair, ...(sheet ? { sheet } : {}), matches }]
    })
  })

  watch(
    hits,
    (rows) => {
      placeStore.setMatchedPairIds(rows.map((row) => row.pair.id))
    },
    { immediate: true },
  )

  function matches(pair: PlacePair): boolean {
    if (!normalizedKeyword.value) {
      return true
    }
    return hits.value.some((hit) => hit.pair.id === pair.id)
  }

  return {
    hits,
    matches,
    highlight: splitHighlight,
  }
}

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Certainty, PlacePair, PlaceType } from '../types/placePair'
import { createId, db, plain } from '../utils/db'
import { touchPlace } from '../utils/searchIndexer'

export type NewPlacePair = Omit<PlacePair, 'id'>

export const usePlaceStore = defineStore('place', () => {
  const pairs = ref<PlacePair[]>([])
  const currentPair = ref<PlacePair | null>(null)
  const placeTypeFilter = ref<PlaceType | '全部'>('全部')
  const certaintyFilter = ref<Certainty | '全部'>('全部')
  const keyword = ref('')
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  const filteredPairs = computed(() =>
    pairs.value.filter((pair) => {
      const matchesType = placeTypeFilter.value === '全部' || pair.placeType === placeTypeFilter.value
      const matchesCertainty =
        certaintyFilter.value === '全部' || pair.certainty === certaintyFilter.value
      return matchesType && matchesCertainty
    }),
  )

  async function init(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (!initialization) {
      initialization = db.placePairs.toArray().then((rows) => {
        pairs.value = rows
        initialized.value = true
      })
    }
    await initialization
  }

  async function addPair(input: NewPlacePair): Promise<PlacePair> {
    await init()
    const pair: PlacePair = { ...input, id: createId('place') }
    await db.placePairs.add(plain(pair))
    pairs.value = [...pairs.value, pair]
    currentPair.value = pair
    // 新地名只重算它自己的索引文档（关联链在构建文档时沿外键读取）。
    void touchPlace(pair.id)
    return pair
  }

  async function loadPair(id: string): Promise<void> {
    await init()
    currentPair.value = pairs.value.find((pair) => pair.id === id) ?? (await db.placePairs.get(id)) ?? null
  }

  function getPairsForSheet(sheetId: string): PlacePair[] {
    return pairs.value.filter((pair) => pair.sheetId === sheetId)
  }

  function resetFilters(): void {
    placeTypeFilter.value = '全部'
    certaintyFilter.value = '全部'
    keyword.value = ''
  }

  return {
    pairs,
    currentPair,
    placeTypeFilter,
    certaintyFilter,
    keyword,
    filteredPairs,
    initialized,
    init,
    addPair,
    loadPair,
    getPairsForSheet,
    resetFilters,
  }
})

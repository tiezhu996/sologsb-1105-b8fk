import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { NameHistory } from '../types/history'
import { createId, db, plain } from '../utils/db'
import { sortByPeriod } from '../utils/scale'

export type NewNameHistory = Omit<NameHistory, 'id'>

export const useHistoryStore = defineStore('history', () => {
  const histories = ref<NameHistory[]>([])
  const currentPairId = ref('')
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  const currentHistories = computed(() =>
    sortByPeriod(
      histories.value.filter((history) => history.placePairId === currentPairId.value),
    ),
  )

  async function init(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (!initialization) {
      initialization = db.histories.toArray().then((rows) => {
        histories.value = rows
        initialized.value = true
      })
    }
    await initialization
  }

  async function loadFor(placePairId: string): Promise<void> {
    await init()
    currentPairId.value = placePairId
  }

  async function addHistory(input: NewNameHistory): Promise<NameHistory> {
    await init()
    const history: NameHistory = { ...input, id: createId('history') }
    await db.histories.add(plain(history))
    histories.value = [...histories.value, history]
    currentPairId.value = history.placePairId
    return history
  }

  function getForPair(placePairId: string): NameHistory[] {
    return sortByPeriod(histories.value.filter((history) => history.placePairId === placePairId))
  }

  return {
    histories,
    currentPairId,
    currentHistories,
    initialized,
    init,
    loadFor,
    addHistory,
    getForPair,
  }
})

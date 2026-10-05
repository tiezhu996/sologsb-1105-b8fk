import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Sheet } from '../types/sheet'
import { useSheetStore } from '../stores/sheetStore'

export const NEIGHBOR_DIRECTIONS = ['东', '南', '西', '北', '东北', '西南'] as const
export type NeighborDirection = (typeof NEIGHBOR_DIRECTIONS)[number]

export interface NeighborEntry {
  code: string
  direction: NeighborDirection
  sheet?: Sheet
}

export interface NeighborStatus {
  source?: Sheet
  entries: NeighborEntry[]
  missingCodes: string[]
  adjacentCount: number
}

export function useSheetNeighbors(sheetId: MaybeRefOrGetter<string>) {
  const sheetStore = useSheetStore()

  function getNeighborStatus(id: string): NeighborStatus {
    const source = sheetStore.getSheetById(id)
    const entries = (source?.neighborCodes ?? []).map((code, index) => {
      const sheet = sheetStore.getSheetByCode(code)
      return {
        code,
        direction: NEIGHBOR_DIRECTIONS[index] ?? NEIGHBOR_DIRECTIONS[0],
        ...(sheet ? { sheet } : {}),
      }
    })
    const missingCodes = entries.filter((entry) => !entry.sheet).map((entry) => entry.code)

    return {
      ...(source ? { source } : {}),
      entries,
      missingCodes,
      adjacentCount: entries.length,
    }
  }

  const status = computed(() => getNeighborStatus(toValue(sheetId)))

  return {
    status,
    getNeighborStatus,
  }
}

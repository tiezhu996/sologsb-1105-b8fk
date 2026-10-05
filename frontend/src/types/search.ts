/**
 * 本地检索索引相关模型。
 *
 * 索引文档（SearchDoc）是源数据（图幅 / 扫描件 / 地名 / 沿革）的反规范化视图，
 * 单独存放在 IndexedDB 中：检索时沿索引游标分批扫描，不把馆藏全量读入内存。
 */

export type SearchRoot = 'sheet' | 'place'

/** 可检索字段。前六项为本轮需求要求的关联链字段，后两项沿用页面既有的方位 / 题名检索。 */
export type SearchField =
  | '图幅号'
  | '古名'
  | '今名'
  | '异写'
  | '沿革'
  | '扫描件名'
  | '图上方位'
  | '图幅题名'

export const SEARCH_FIELDS: SearchField[] = [
  '图幅号',
  '图幅题名',
  '古名',
  '今名',
  '异写',
  '沿革',
  '扫描件名',
  '图上方位',
]

export interface SearchFieldHit {
  field: SearchField
  text: string
}

/**
 * 检索索引文档。
 * docId 为确定性主键（`sheet:{id}` / `place:{id}`），重建时重复写入也只覆盖自身，不会产生重复条目。
 */
export interface SearchDoc {
  docId: string
  root: SearchRoot
  sourceId: string
  sheetId: string
  /** 全部字段文本以分隔符拼接后的小写副本，用于一次性子串判断。 */
  haystack: string
  fields: SearchFieldHit[]
  updatedAt: number
}

/** 受影响条目队列：源数据变化时只重算这里登记的文档。 */
export interface SearchDirtyEntry {
  docId: string
  root: SearchRoot
  sourceId: string
  enqueuedAt: number
}

export type IndexPhase = 'idle' | 'building' | 'paused' | 'error'
export type IndexStage = 'sheets' | 'places' | 'done'

/** 重建检查点。每处理完一批即整体覆写，中断后凭游标续做。 */
export interface IndexMeta {
  key: 'index'
  phase: IndexPhase
  stage: IndexStage
  /** 图幅阶段已处理到的主键（不含），null 表示该阶段从头开始。 */
  sheetsAfterId: string | null
  /** 地名阶段已处理到的主键（不含）。 */
  placesAfterId: string | null
  indexedSheets: number
  indexedPlaces: number
  totalSource: number
  checkpointAt: number | null
  updatedAt: number | null
  error: string | null
  /** 每次完整重建或一批受影响条目重算完成后递增，供页面判断是否需要重新检索。 */
  docsRev: number
}

/** 命中后沿关联链回水合出的上下文。 */
export interface SearchChain {
  sheetId: string
  sheetCode: string
  sheetTitle: string
  placePairId?: string
  scanFileNames: string[]
}

export interface SearchHit {
  doc: SearchDoc
  chain: SearchChain
  matchedFields: SearchFieldHit[]
}

export function buildDocId(root: SearchRoot, sourceId: string): string {
  return `${root}:${sourceId}`
}

export function parseDocId(docId: string): { root: SearchRoot; sourceId: string } | null {
  const separator = docId.indexOf(':')
  if (separator <= 0) {
    return null
  }
  const root = docId.slice(0, separator)
  if (root !== 'sheet' && root !== 'place') {
    return null
  }
  return { root, sourceId: docId.slice(separator + 1) }
}

import type { Collection } from 'dexie'
import { db } from './db'
import type { NameHistory } from '../types/history'
import type { PlacePair } from '../types/placePair'
import type { ScanItem } from '../types/scan'
import {
  buildDocId,
  parseDocId,
  type SearchChain,
  type SearchDoc,
  type SearchField,
  type SearchFieldHit,
  type SearchHit,
  type SearchRoot,
} from '../types/search'
import type { Sheet } from '../types/sheet'

export function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase()
}

export interface SearchOptions {
  fields?: SearchField[]
  roots?: SearchRoot[]
}

export interface SearchPageOptions extends SearchOptions {
  signal?: AbortSignal
}

function fieldAllowed(field: SearchField, options: SearchOptions): boolean {
  return !options.fields || options.fields.length === 0 || options.fields.includes(field)
}

function rootAllowed(root: SearchRoot, options: SearchOptions): boolean {
  return !options.roots || options.roots.length === 0 || options.roots.includes(root)
}

function matchDoc(doc: SearchDoc, query: string, options: SearchOptions): SearchFieldHit[] {
  if (!rootAllowed(doc.root, options)) {
    return []
  }
  // haystack 一次子串判断做快速初筛，命不中就不逐字段遍历。
  if (!doc.haystack.includes(query)) {
    return []
  }
  const hits: SearchFieldHit[] = []
  for (const fieldHit of doc.fields) {
    if (fieldAllowed(fieldHit.field, options) && fieldHit.text.toLocaleLowerCase().includes(query)) {
      hits.push(fieldHit)
    }
  }
  return hits
}

/** 单批游标扫描后让出事件循环，避免长时间占住主线程。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

const SCAN_BATCH = 80
/** 主键异常情况下的安全阀，正常馆藏不会触及。 */
const SCAN_GUARD = 1_000_000

/**
 * 沿 searchDocs 主键顺序做有界游标扫描。
 * - 'page' 模式统计 total 并收集 offset/limit 窗口内的文档，内存占用以一页为上限；
 * - 'ids'  模式只收集命中源条目 id，供内存列表做轻量过滤。
 * 每批 80 条让出一次事件循环，大库下界面不卡死、可被 signal 中止。
 */
async function scanChunked(
  query: string,
  options: SearchPageOptions,
  mode: 'page',
  limit: number,
  offset: number,
): Promise<{ total: number; page: SearchDoc[] }>
async function scanChunked(
  query: string,
  options: SearchPageOptions,
  mode: 'ids',
): Promise<Set<string>>
async function scanChunked(
  query: string,
  options: SearchPageOptions,
  mode: 'page' | 'ids',
  limit = 0,
  offset = 0,
): Promise<{ total: number; page: SearchDoc[] } | Set<string>> {
  let total = 0
  const page: SearchDoc[] = []
  const ids = new Set<string>()
  let after: string | null = null
  let guard = 0

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('检索已取消', 'AbortError')
    }
    const collection: Collection<SearchDoc, string, SearchDoc> = after
      ? db.searchDocs.where('docId').above(after)
      : db.searchDocs.orderBy('docId')
    const chunk: SearchDoc[] = await collection.limit(SCAN_BATCH).toArray()
    if (chunk.length === 0) {
      break
    }
    for (const doc of chunk) {
      if (matchDoc(doc, query, options).length === 0) {
        continue
      }
      if (mode === 'ids') {
        ids.add(doc.sourceId)
        continue
      }
      total += 1
      if (total > offset && page.length < limit) {
        page.push(doc)
      }
    }
    after = chunk[chunk.length - 1].docId
    await yieldToEventLoop()
    guard += 1
    if (guard > SCAN_GUARD) {
      break
    }
  }

  return mode === 'ids' ? ids : { total, page }
}

function collectPlaceSourceIds(docs: SearchDoc[]): string[] {
  const ids = new Set<string>()
  for (const doc of docs) {
    if (doc.root === 'place') {
      ids.add(doc.sourceId)
    }
  }
  return [...ids]
}

/** 沿 图幅 → 扫描件 / 地名 → 沿革 的关联链回水合命中上下文（只取当前页涉及的条目）。 */
export async function hydrateHits(
  docs: SearchDoc[],
  query: string,
  options: SearchOptions,
): Promise<SearchHit[]> {
  const sheetIds = new Set(docs.map((doc) => doc.sheetId))
  const placeSourceIds = collectPlaceSourceIds(docs)

  const [sheets, pairs, scans, histories] = await Promise.all([
    sheetIds.size ? db.sheets.bulkGet([...sheetIds]) : Promise.resolve([]),
    placeSourceIds.length ? db.placePairs.bulkGet(placeSourceIds) : Promise.resolve([]),
    sheetIds.size ? db.scans.where('sheetId').anyOf([...sheetIds]).toArray() : Promise.resolve([]),
    placeSourceIds.length
      ? db.histories.where('placePairId').anyOf(placeSourceIds).toArray()
      : Promise.resolve([]),
  ])

  const sheetMap = new Map(sheets.filter(Boolean).map((sheet) => [sheet!.id, sheet!]))
  const pairMap = new Map(pairs.filter(Boolean).map((pair) => [pair!.id, pair!]))
  const scansBySheet = new Map<string, ScanItem[]>()
  for (const scan of scans) {
    const list = scansBySheet.get(scan.sheetId) ?? []
    list.push(scan)
    scansBySheet.set(scan.sheetId, list)
  }
  const historiesByPair = new Map<string, NameHistory[]>()
  for (const history of histories) {
    const list = historiesByPair.get(history.placePairId) ?? []
    list.push(history)
    historiesByPair.set(history.placePairId, list)
  }

  return docs.map((doc) => {
    const sheet = sheetMap.get(doc.sheetId)
    const pair = doc.root === 'place' ? pairMap.get(doc.sourceId) : undefined
    const chain: SearchChain = {
      sheetId: doc.sheetId,
      sheetCode: sheet?.code ?? '',
      sheetTitle: sheet?.title ?? '',
      ...(pair ? { placePairId: pair.id } : {}),
      scanFileNames: (scansBySheet.get(doc.sheetId) ?? []).map((scan) => scan.fileName),
    }
    return {
      doc,
      chain,
      matchedFields: matchDoc(doc, query, options),
    }
  })
}

export interface SearchPageResult {
  hits: SearchHit[]
  total: number
}

/**
 * 分页综合检索：关键词可落在图幅号、古名、今名、异写、沿革、扫描件名等字段。
 * 空关键词归一化为空串，所有文档字段均为非空时等价于全量浏览。
 */
export async function searchPage(
  rawKeyword: string,
  options: SearchPageOptions & { limit?: number; offset?: number } = {},
): Promise<SearchPageResult> {
  const query = normalizeText(rawKeyword)
  const limit = Math.max(1, options.limit ?? 20)
  const offset = Math.max(0, options.offset ?? 0)
  const { total, page } = await scanChunked(query, options, 'page', limit, offset)
  const hits = await hydrateHits(page, query, options)
  return { hits, total }
}

/** 仅取命中的源条目 id 集合，供地名对照台等内存列表做轻量过滤，不做关联链水合。 */
export async function searchMatchedSourceIds(
  root: SearchRoot,
  rawKeyword: string,
  options: SearchOptions = {},
): Promise<Set<string>> {
  const query = normalizeText(rawKeyword)
  return scanChunked(query, { ...options, roots: [root] }, 'ids')
}

/**
 * 组装单个地名条目的索引字段：
 * 沿 地名 → 图幅 → 扫描件 与 地名 → 沿革 把关联链文本汇集到同一文档。
 */
export function buildPlaceFields(
  pair: PlacePair,
  sheet: Sheet | undefined,
  sheetScans: ScanItem[],
  pairHistories: NameHistory[],
): SearchFieldHit[] {
  const fields: SearchFieldHit[] = []
  const push = (field: SearchField, text: string) => {
    const trimmed = text.trim()
    if (trimmed) {
      fields.push({ field, text: trimmed })
    }
  }

  if (sheet) {
    push('图幅号', sheet.code)
    push('图幅题名', sheet.title)
  }
  push('古名', pair.oldName)
  push('今名', pair.newName)
  for (const alias of pair.aliasList) {
    push('异写', alias)
  }
  for (const history of pairHistories) {
    push('沿革', `${history.name} ${history.period} ${history.changeType}`)
  }
  for (const scan of sheetScans) {
    push('扫描件名', scan.fileName)
  }
  push('图上方位', pair.coordNote)
  return fields
}

/** 组装单个图幅条目的索引字段：图幅自身文本 + 该图幅全部扫描件名。 */
export function buildSheetFields(sheet: Sheet, sheetScans: ScanItem[]): SearchFieldHit[] {
  const fields: SearchFieldHit[] = []
  const push = (field: SearchField, text: string) => {
    const trimmed = text.trim()
    if (trimmed) {
      fields.push({ field, text: trimmed })
    }
  }

  push('图幅号', sheet.code)
  push('图幅题名', sheet.title)
  for (const scan of sheetScans) {
    push('扫描件名', scan.fileName)
  }
  return fields
}

export function fieldsToHaystack(fields: SearchFieldHit[]): string {
  return fields.map((field) => field.text.toLocaleLowerCase()).join('\n')
}

export function sheetDocId(sheetId: string): string {
  return buildDocId('sheet', sheetId)
}

export function placeDocId(placePairId: string): string {
  return buildDocId('place', placePairId)
}

export { buildDocId, parseDocId }

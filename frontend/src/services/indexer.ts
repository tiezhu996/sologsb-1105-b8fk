import { reactive } from 'vue'
import { db } from '../utils/db'
import {
  analyzeTerm,
  buildHistoryDoc,
  buildPairDoc,
  buildScanDoc,
  buildSheetDoc,
  docToTokens,
  highlightTerms,
} from '../utils/searchIndex'
import type { NameHistory } from '../types/history'
import type { PlacePair } from '../types/placePair'
import type { ScanItem } from '../types/scan'
import type {
  BuildState,
  FieldMatch,
  IndexChange,
  SearchDoc,
  SearchHitGroup,
  SearchKind,
  SearchSnapshot,
} from '../types/search'
import type { Sheet } from '../types/sheet'

/**
 * 本地检索索引引擎。
 *
 * - 全量重建分批提交，每批落一条检查点（表序 + 主键游标），
 *   失败或取消后从检查点续做；文档按主键覆盖、倒排行按
 *   [token+docId] 覆盖，重放批次不会产生重复条目。
 * - 数据变化只重算受影响条目：源表写入后调用 notifyUpsert /
 *   notifyRemove，合并成一个增量批次提交。
 * - 查询在单个只读事务内完成，读到的是同一代索引的一致快照；
 *   重建期间查询返回 null，由页面继续展示上一份完整结果。
 */

const BATCH_SIZE = 200
const MAX_CANDIDATES = 600
const MAX_GROUPS = 60
/** 索引结构版本：与 db.ts 中表结构同步演进，不一致即触发整库重建 */
export const INDEX_SCHEMA_REV = 3
const META_KEY = 'build'

const TABLE_ORDER = ['sheets', 'scans', 'placePairs', 'histories'] as const
type SourceTable = (typeof TABLE_ORDER)[number]

const TABLE_LABEL: Record<SourceTable, string> = {
  sheets: '图幅',
  scans: '扫描件',
  placePairs: '地名对照',
  histories: '沿革',
}

const KIND_OF_TABLE: Record<SourceTable, SearchKind> = {
  sheets: 'sheet',
  scans: 'scan',
  placePairs: 'pair',
  histories: 'history',
}

const KIND_ORDER: SearchKind[] = ['sheet', 'scan', 'pair', 'history']

const TABLE_OF_KIND: Record<SearchKind, SourceTable> = {
  sheet: 'sheets',
  scan: 'scans',
  pair: 'placePairs',
  history: 'histories',
}

export const indexerStatus = reactive({
  phase: 'building' as 'building' | 'ready',
  paused: false,
  done: 0,
  total: 0,
  tableLabel: '',
  generation: 0,
  docCount: 0,
  error: '',
})

type IndexerEvent = 'commit' | 'ready'

const listeners: Record<IndexerEvent, Set<() => void>> = {
  commit: new Set(),
  ready: new Set(),
}

export function onIndexerEvent(event: IndexerEvent, fn: () => void): () => void {
  listeners[event].add(fn)
  return () => listeners[event].delete(fn)
}

function emit(event: IndexerEvent): void {
  for (const fn of listeners[event]) {
    fn()
  }
}

let cancelRequested = false
let buildPromise: Promise<void> | null = null
let ensurePromise: Promise<void> | null = null

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function readState(): Promise<BuildState | undefined> {
  return db.searchMeta.get(META_KEY)
}

async function syncStatus(state?: BuildState): Promise<void> {
  const current = state ?? (await readState())
  indexerStatus.phase = current?.status === 'ready' ? 'ready' : 'building'
  indexerStatus.paused = current?.paused ?? false
  indexerStatus.done = current?.done ?? 0
  indexerStatus.total = current?.total ?? 0
  indexerStatus.generation = current?.generation ?? 0
  indexerStatus.error = current?.error ?? ''
  const tableName = current ? TABLE_ORDER[current.tableIndex] : undefined
  indexerStatus.tableLabel = tableName ? TABLE_LABEL[tableName] : '收尾'
  indexerStatus.docCount = await db.searchDocs.count()
}

/**
 * 单批文档写入。replaceTokens 为 true 时先逐篇清掉旧倒排行再覆盖，
 * 用于实体内容发生变化的增量更新；整库重建的批次传 false——
 * 重建从清空表开始，且同一结构版本下倒排词是文档的纯函数，
 * 重放批次按主键覆盖即幂等，无需先删。
 * 清理走「读主键 + 按主键删」，避开 anyOf 大数组与游标删除。
 */
async function putDocs(docs: SearchDoc[], replaceTokens: boolean): Promise<void> {
  if (docs.length === 0) {
    return
  }
  if (replaceTokens) {
    for (const doc of docs) {
      const staleKeys = await db.searchTokens.where('docId').equals(doc.id).primaryKeys()
      if (staleKeys.length > 0) {
        await db.searchTokens.bulkDelete(staleKeys)
      }
    }
  }
  await db.searchDocs.bulkPut(docs)
  await db.searchTokens.bulkPut(docs.flatMap(docToTokens))
}

async function removeDocs(docIds: string[]): Promise<void> {
  for (const docId of docIds) {
    const staleKeys = await db.searchTokens.where('docId').equals(docId).primaryKeys()
    if (staleKeys.length > 0) {
      await db.searchTokens.bulkDelete(staleKeys)
    }
  }
  await db.searchDocs.bulkDelete(docIds)
}

async function buildDocsFor(kind: SearchKind, entities: Array<{ id: string }>): Promise<SearchDoc[]> {
  switch (kind) {
    case 'sheet':
      return (entities as Sheet[]).map(buildSheetDoc)
    case 'scan':
      return (entities as ScanItem[]).map(buildScanDoc)
    case 'pair':
      return (entities as PlacePair[]).map(buildPairDoc)
    case 'history': {
      const histories = entities as NameHistory[]
      const pairIds = [...new Set(histories.map((history) => history.placePairId))]
      const pairs = await db.placePairs.bulkGet(pairIds)
      const sheetOfPair = new Map(
        pairs.filter((pair): pair is PlacePair => Boolean(pair)).map((pair) => [pair.id, pair.sheetId]),
      )
      return histories.flatMap((history) => {
        const sheetId = sheetOfPair.get(history.placePairId)
        return sheetId ? [buildHistoryDoc(history, sheetId)] : []
      })
    }
  }
}

/** 应用一批增量变更：只重算受影响的条目，提交后索引代数 +1 */
async function applyIncremental(changes: IndexChange[]): Promise<void> {
  const docs: SearchDoc[] = []
  const removedDocIds: string[] = []

  for (const kind of KIND_ORDER) {
    const group = changes.filter((change) => change.kind === kind)
    if (group.length === 0) {
      continue
    }
    const deleted = group.filter((change) => change.deleted)
    removedDocIds.push(...deleted.map((change) => `${kind}:${change.id}`))

    const pendingIds = group.filter((change) => !change.deleted).map((change) => change.id)
    if (pendingIds.length === 0) {
      continue
    }
    const table = db.table(TABLE_OF_KIND[kind])
    const entities = (await table.bulkGet(pendingIds)).filter(Boolean) as Array<{ id: string }>
    const foundIds = new Set(entities.map((entity) => entity.id))
    // 源表里已不存在的条目按删除处理
    removedDocIds.push(
      ...pendingIds.filter((id) => !foundIds.has(id)).map((id) => `${kind}:${id}`),
    )
    docs.push(...(await buildDocsFor(kind, entities)))
  }

  await db.transaction('rw', [db.searchDocs, db.searchTokens, db.searchMeta], async () => {
    await putDocs(docs, true)
    await removeDocs([...new Set(removedDocIds)])
    const state = await db.searchMeta.get(META_KEY)
    if (state) {
      await db.searchMeta.update(META_KEY, { generation: state.generation + 1 })
    }
  })
  await syncStatus()
}

async function finalizeBuild(state: BuildState): Promise<void> {
  // 建库期间到达的变更在收尾时统一重放，之后整库切为就绪
  if (state.dirty.length > 0) {
    await applyIncremental(state.dirty)
  }
  await db.transaction('rw', [db.searchMeta], async () => {
    const current = await db.searchMeta.get(META_KEY)
    await db.searchMeta.update(META_KEY, {
      status: 'ready',
      paused: false,
      error: '',
      dirty: [],
      cursor: null,
      tableIndex: 0,
      generation: (current?.generation ?? state.generation) + 1,
    })
  })
  await syncStatus()
  emit('ready')
  emit('commit')
}

async function runBuildLoop(): Promise<void> {
  try {
    for (;;) {
      if (cancelRequested) {
        await db.searchMeta.update(META_KEY, { paused: true })
        await syncStatus()
        return
      }
      const state = await readState()
      if (!state || state.status !== 'building') {
        await syncStatus(state)
        return
      }
      if (state.tableIndex >= TABLE_ORDER.length) {
        await finalizeBuild(state)
        return
      }

      const tableName = TABLE_ORDER[state.tableIndex]
      const table = db.table(tableName)
      const batch =
        state.cursor === null
          ? await table.limit(BATCH_SIZE).toArray()
          : await table.where(':id').above(state.cursor).limit(BATCH_SIZE).toArray()

      if (batch.length === 0) {
        await db.searchMeta.update(META_KEY, { tableIndex: state.tableIndex + 1, cursor: null })
        continue
      }

      const docs = await buildDocsFor(KIND_OF_TABLE[tableName], batch)
      const lastId = batch[batch.length - 1].id as string
      await db.transaction('rw', [db.searchDocs, db.searchTokens, db.searchMeta], async () => {
        // 重建批次无需先删旧倒排：表已清空，重放行的词与键完全一致
        await putDocs(docs, false)
        await db.searchMeta.update(META_KEY, {
          cursor: lastId,
          done: state.done + batch.length,
        })
      })
      await syncStatus()
      await yieldToUi()
    }
  } catch (error) {
    // 检查点已随上一批提交落库，此处只标记暂停，等待续做
    await db.searchMeta
      .update(META_KEY, { paused: true, error: error instanceof Error ? error.message : String(error) })
      .catch(() => undefined)
    await syncStatus().catch(() => undefined)
  }
}

function runBuildGuarded(): Promise<void> {
  if (!buildPromise) {
    buildPromise = (async () => {
      await db.searchMeta
        .update(META_KEY, { paused: false, error: '' })
        .catch(() => undefined)
      await runBuildLoop()
    })().finally(() => {
      buildPromise = null
    })
  }
  return buildPromise
}

async function startFullRebuild(): Promise<void> {
  const counts = await Promise.all(TABLE_ORDER.map((tableName) => db.table(tableName).count()))
  const total = counts.reduce((sum, count) => sum + count, 0)
  await db.transaction('rw', [db.searchMeta, db.searchDocs, db.searchTokens], async () => {
    await db.searchTokens.clear()
    await db.searchDocs.clear()
    const previous = await db.searchMeta.get(META_KEY)
    await db.searchMeta.put({
      key: META_KEY,
      schemaRev: INDEX_SCHEMA_REV,
      status: 'building',
      paused: false,
      tableIndex: 0,
      cursor: null,
      done: 0,
      total,
      generation: previous?.generation ?? 0,
      error: '',
      dirty: [],
    } satisfies BuildState)
  })
  await syncStatus()
  await runBuildGuarded()
}

/**
 * 应用启动时调用：索引缺失、结构过旧或视图损坏则分批重建；
 * 上次中断在 building 状态则从检查点续做。多次调用共享同一 Promise。
 */
export function ensureIndex(): Promise<void> {
  if (!ensurePromise) {
    // 取消标记只作用于当前这次构建，新的启动/续做请求将其清零
    cancelRequested = false
    ensurePromise = (async () => {
      let state: BuildState | undefined
      let corrupt = false
      try {
        state = await readState()
        if (!state || state.schemaRev !== INDEX_SCHEMA_REV) {
          corrupt = true
        } else if (state.status === 'ready') {
          const [sheetCount, docCount] = await Promise.all([db.sheets.count(), db.searchDocs.count()])
          if (sheetCount > 0 && docCount === 0) {
            corrupt = true
          }
        }
      } catch {
        corrupt = true
      }

      if (corrupt) {
        await startFullRebuild()
      } else if (state?.status === 'building') {
        await runBuildGuarded()
      } else {
        await syncStatus(state)
      }
    })().finally(() => {
      ensurePromise = null
    })
  }
  return ensurePromise
}

/** 手动触发整库重建（视图损坏修复或结构升级） */
export async function rebuildIndex(): Promise<void> {
  cancelRequested = false
  await startFullRebuild()
}

/** 请求取消：当前批次提交后停下并保留检查点 */
export function cancelIndexBuild(): void {
  cancelRequested = true
}

const pendingChanges: IndexChange[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function notifyUpsert(kind: SearchKind, id: string): void {
  enqueueChange({ kind, id })
}

export function notifyRemove(kind: SearchKind, id: string): void {
  enqueueChange({ kind, id, deleted: true })
}

function enqueueChange(change: IndexChange): void {
  pendingChanges.push(change)
  if (flushTimer) {
    clearTimeout(flushTimer)
  }
  flushTimer = setTimeout(() => {
    void flushPending()
  }, 60)
}

function dedupeChanges(changes: IndexChange[]): IndexChange[] {
  const byKey = new Map<string, IndexChange>()
  for (const change of changes) {
    byKey.set(`${change.kind}:${change.id}`, change)
  }
  return [...byKey.values()]
}

async function flushPending(): Promise<void> {
  const changes = dedupeChanges(pendingChanges.splice(0))
  if (changes.length === 0) {
    return
  }
  try {
    const state = await readState()
    if (!state) {
      // 索引尚未建立，触发整库重建即可覆盖这些变更
      await ensureIndex()
      return
    }
    if (state.status !== 'ready') {
      // 建库期间：变更持久化到脏队列，收尾时统一重放
      const dirty = dedupeChanges([...state.dirty, ...changes])
      await db.searchMeta.update(META_KEY, { dirty })
      return
    }
    await applyIncremental(changes)
    emit('commit')
  } catch (error) {
    // 增量失败不入库，变更放回队列等待下次触发，避免索引与数据长期脱节
    pendingChanges.unshift(...changes)
    console.error('[indexer] 增量索引失败，已回排等待重试', error)
  }
}

function intersectInto(acc: Set<string>, next: Set<string>): Set<string> {
  for (const id of acc) {
    if (!next.has(id)) {
      acc.delete(id)
    }
  }
  return acc
}

async function termCandidates(term: string): Promise<Set<string>> {
  const { exact, prefixes } = analyzeTerm(term)
  let acc: Set<string> | null = null

  const absorb = (docIds: string[]) => {
    const next = new Set(docIds)
    acc = acc === null ? next : intersectInto(acc, next)
  }

  for (const token of exact) {
    const rows = await db.searchTokens.where('token').equals(token).toArray()
    absorb(rows.map((row) => row.docId))
  }
  for (const prefix of prefixes) {
    const rows = await db.searchTokens.where('token').startsWith(prefix).toArray()
    absorb(rows.map((row) => row.docId))
  }

  return acc ?? new Set<string>()
}

/** 复核：每个查询词都必须作为子串出现在文档的至少一个字段里 */
function verifyDoc(doc: SearchDoc, terms: string[]): FieldMatch[] | null {
  const lowered = doc.fields.map((field) => field.text.toLocaleLowerCase())
  for (const term of terms) {
    if (!lowered.some((text) => text.includes(term))) {
      return null
    }
  }
  const matched: FieldMatch[] = []
  doc.fields.forEach((field, index) => {
    const hitTerms = terms.filter((term) => lowered[index].includes(term))
    if (hitTerms.length > 0) {
      matched.push({ label: field.label, parts: highlightTerms(field.text, hitTerms) })
    }
  })
  return matched
}

interface PairBucket {
  doc?: SearchDoc
  fields: FieldMatch[]
  histories: Array<{ doc: SearchDoc; fields: FieldMatch[] }>
}

interface GroupBucket {
  sheetDoc?: SearchDoc
  sheetFields: FieldMatch[]
  scans: Array<{ doc: SearchDoc; fields: FieldMatch[] }>
  pairs: Map<string, PairBucket>
  hits: number
}

/** 排序阶段使用的分组，hits 仅用于组间排序，不进入最终快照 */
type ScoredGroup = SearchHitGroup & { hits: number }

/**
 * 执行一次检索。整份结果在同一个只读事务里算出，
 * 索引若在重建中返回 null，调用方继续展示上一份快照。
 */
export async function search(rawQuery: string): Promise<SearchSnapshot | null> {
  const query = rawQuery.trim()
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return null
  }

  return db.transaction(
    'r',
    [db.searchMeta, db.searchDocs, db.searchTokens, db.scans, db.placePairs],
    async () => {
      const state = await db.searchMeta.get(META_KEY)
      if (!state || state.status !== 'ready') {
        return null
      }

      let candidates: Set<string> | null = null
      for (const term of terms) {
        const termIds = await termCandidates(term)
        candidates = candidates === null ? termIds : intersectInto(candidates, termIds)
        if (candidates.size === 0) {
          break
        }
      }

      const allIds = [...(candidates ?? new Set<string>())].sort()
      const truncatedCandidates = allIds.length > MAX_CANDIDATES
      const docs = await db.searchDocs.bulkGet(allIds.slice(0, MAX_CANDIDATES))

      const buckets = new Map<string, GroupBucket>()
      let totalHits = 0
      for (const doc of docs) {
        if (!doc) {
          continue
        }
        const fields = verifyDoc(doc, terms)
        if (!fields) {
          continue
        }
        totalHits += 1
        let bucket = buckets.get(doc.sheetId)
        if (!bucket) {
          bucket = { sheetFields: [], scans: [], pairs: new Map(), hits: 0 }
          buckets.set(doc.sheetId, bucket)
        }
        bucket.hits += 1
        if (doc.kind === 'sheet') {
          bucket.sheetDoc = doc
          bucket.sheetFields = fields
        } else if (doc.kind === 'scan') {
          bucket.scans.push({ doc, fields })
        } else if (doc.kind === 'pair') {
          const entry = bucket.pairs.get(doc.entityId) ?? { fields: [], histories: [] }
          entry.doc = doc
          entry.fields = fields
          bucket.pairs.set(doc.entityId, entry)
        } else {
          const entry = bucket.pairs.get(doc.parentId) ?? { fields: [], histories: [] }
          entry.histories.push({ doc, fields })
          bucket.pairs.set(doc.parentId, entry)
        }
      }

      // 沿关联链补齐上级文档：图幅（链根）与地名（沿革的上级）
      const sheetDocIds = [...buckets.keys()].map((sheetId) => `sheet:${sheetId}`)
      const missingPairIds = [...buckets.values()].flatMap((bucket) =>
        [...bucket.pairs.entries()].filter(([, entry]) => !entry.doc).map(([pairId]) => pairId),
      )
      const [sheetDocs, pairDocs] = await Promise.all([
        db.searchDocs.bulkGet(sheetDocIds),
        db.searchDocs.bulkGet(missingPairIds.map((pairId) => `pair:${pairId}`)),
      ])
      const sheetDocById = new Map(
        sheetDocs.filter((doc): doc is SearchDoc => Boolean(doc)).map((doc) => [doc.entityId, doc]),
      )
      const pairDocById = new Map(
        pairDocs.filter((doc): doc is SearchDoc => Boolean(doc)).map((doc) => [doc.entityId, doc]),
      )

      const groups: ScoredGroup[] = await Promise.all(
        [...buckets.entries()].map(async ([sheetId, bucket]) => {
          const sheetDoc = bucket.sheetDoc ?? sheetDocById.get(sheetId)
          const [scanCount, pairCount] = await Promise.all([
            db.scans.where('sheetId').equals(sheetId).count(),
            db.placePairs.where('sheetId').equals(sheetId).count(),
          ])
          return {
            sheet: {
              id: sheetId,
              code: sheetDoc?.primary ?? '图幅待补',
              title: sheetDoc?.secondary ?? '',
              year: sheetDoc?.fields.find((field) => field.label === '年代')?.text ?? '',
              matched: Boolean(bucket.sheetDoc),
              fields: bucket.sheetFields,
            },
            scanCount,
            pairCount,
            scans: bucket.scans.map(({ doc, fields }) => ({
              id: doc.entityId,
              fileName: doc.primary,
              fields,
            })),
            pairs: [...bucket.pairs.entries()].map(([pairId, entry]) => {
              const pairDoc = entry.doc ?? pairDocById.get(pairId)
              return {
                id: pairId,
                oldName: pairDoc?.primary ?? '地名待补',
                newName: pairDoc?.secondary ?? '',
                fields: entry.fields,
                histories: entry.histories.map(({ doc, fields }) => ({
                  id: doc.entityId,
                  period: doc.secondary,
                  name: doc.primary,
                  fields,
                })),
              }
            }),
            hits: bucket.hits,
          }
        }),
      )

      groups.sort((left, right) => {
        const direct = Number(right.sheet.matched) - Number(left.sheet.matched)
        if (direct !== 0) {
          return direct
        }
        if (left.hits !== right.hits) {
          return right.hits - left.hits
        }
        return left.sheet.code.localeCompare(right.sheet.code, 'zh-CN')
      })

      const truncatedGroups = groups.length > MAX_GROUPS
      const visible: SearchHitGroup[] = groups.slice(0, MAX_GROUPS).map(({ hits, ...group }) => group)

      return {
        query,
        generation: state.generation,
        finishedAt: Date.now(),
        totalHits,
        truncated: truncatedCandidates || truncatedGroups,
        groups: visible,
      } satisfies SearchSnapshot
    },
  )
}

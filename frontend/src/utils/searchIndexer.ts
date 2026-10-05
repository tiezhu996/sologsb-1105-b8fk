import { db } from './db'
import type {
  IndexMeta,
  IndexPhase,
  IndexStage,
  SearchDirtyEntry,
  SearchDoc,
  SearchRoot,
} from '../types/search'
import {
  buildPlaceFields,
  buildSheetFields,
  fieldsToHaystack,
  placeDocId,
  sheetDocId,
} from './searchEngine'

/** 每批处理的源条目数；每批落一次检查点，并让出事件循环。 */
const REBUILD_BATCH = 200
const META_KEY = 'index'

export type IndexEventType =
  | 'meta' // 检查点 / 阶段状态变化
  | 'pump-start' // 一批受影响条目开始重算
  | 'pump-done' // 一批受影响条目重算完成（docsRev 递增）
  | 'build-cancelled'
  | 'build-failed'

export interface IndexEvent {
  type: IndexEventType
  meta: IndexMeta
}

type Listener = (event: IndexEvent) => void

const listeners = new Set<Listener>()

export function onIndexEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(type: IndexEventType, meta: IndexMeta): void {
  for (const listener of [...listeners]) {
    listener({ type, meta })
  }
}

function defaultMeta(): IndexMeta {
  return {
    key: META_KEY,
    phase: 'building',
    stage: 'sheets',
    sheetsAfterId: null,
    placesAfterId: null,
    indexedSheets: 0,
    indexedPlaces: 0,
    totalSource: 0,
    checkpointAt: null,
    updatedAt: null,
    error: null,
    docsRev: 0,
  }
}

async function readMeta(): Promise<IndexMeta | undefined> {
  return db.searchMeta.get(META_KEY)
}

async function writeMeta(patch: Partial<IndexMeta>): Promise<IndexMeta> {
  const current = (await readMeta()) ?? defaultMeta()
  const next: IndexMeta = { ...current, ...patch, key: META_KEY }
  await db.searchMeta.put(next)
  emit('meta', next)
  return next
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// ---- 索引文档构建（单条，幂等） ------------------------------------------------

async function buildSheetDoc(sheetId: string): Promise<SearchDoc | null> {
  const sheet = await db.sheets.get(sheetId)
  if (!sheet) {
    return null
  }
  const sheetScans = await db.scans.where('sheetId').equals(sheetId).toArray()
  const fields = buildSheetFields(sheet, sheetScans)
  return {
    docId: sheetDocId(sheet.id),
    root: 'sheet',
    sourceId: sheet.id,
    sheetId: sheet.id,
    haystack: fieldsToHaystack(fields),
    fields,
    updatedAt: Date.now(),
  }
}

async function buildPlaceDoc(placePairId: string): Promise<SearchDoc | null> {
  const pair = await db.placePairs.get(placePairId)
  if (!pair) {
    return null
  }
  const sheet = await db.sheets.get(pair.sheetId)
  const [sheetScans, pairHistories] = await Promise.all([
    db.scans.where('sheetId').equals(pair.sheetId).toArray(),
    db.histories.where('placePairId').equals(pair.id).toArray(),
  ])
  const fields = buildPlaceFields(pair, sheet, sheetScans, pairHistories)
  return {
    docId: placeDocId(pair.id),
    root: 'place',
    sourceId: pair.id,
    sheetId: pair.sheetId,
    haystack: fieldsToHaystack(fields),
    fields,
    updatedAt: Date.now(),
  }
}

async function buildDocFor(root: SearchRoot, sourceId: string): Promise<SearchDoc | null> {
  return root === 'sheet' ? buildSheetDoc(sourceId) : buildPlaceDoc(sourceId)
}

// ---- 全量分批重建（检查点 + 续做） ---------------------------------------------

let buildToken = 0

/**
 * 首次建立或视图损坏后的分批重建。
 * - 默认（resume=false）：清空视图与检查点，从头分批建立；
 * - resume=true：保留检查点，从断点续做（失败、取消、页面重开后使用）。
 * 同一时刻只有一个重建循环；已有构建进行中时返回进行中任务。
 */
export async function rebuild(options: { resume?: boolean } = {}): Promise<IndexMeta> {
  if (activeBuild) {
    return activeBuild
  }
  const existing = await readMeta()
  if (!options.resume || !existing || existing.phase === 'idle') {
    await db.transaction('rw', db.searchDocs, db.searchDirty, db.searchMeta, async () => {
      await db.searchDocs.clear()
      await db.searchDirty.clear()
      await db.searchMeta.put(defaultMeta())
    })
  }
  return startBuildLoop()
}

let activeBuild: Promise<IndexMeta> | null = null

function startBuildLoop(): Promise<IndexMeta> {
  if (activeBuild) {
    return activeBuild
  }
  const token = ++buildToken
  activeBuild = runBuildLoop(token)
    .finally(() => {
      activeBuild = null
    })
  return activeBuild
}

async function runBuildLoop(token: number): Promise<IndexMeta> {
  try {
    let meta = await readMeta()
    if (!meta) {
      meta = defaultMeta()
      await db.searchMeta.put(meta)
    }
    const totalSource = await Promise.all([db.sheets.count(), db.placePairs.count()]).then(
      ([sheetCount, placeCount]) => sheetCount + placeCount,
    )
    meta = await writeMeta({ phase: 'building', error: null, totalSource })

    // 阶段一：图幅 ----------------------------------------------------------
    if (meta.stage === 'sheets') {
      let after = meta.sheetsAfterId
      let indexed = meta.indexedSheets
      for (;;) {
        if (token !== buildToken) {
          return writeMeta({ phase: 'paused', checkpointAt: Date.now() })
        }
        const collection = after
          ? db.sheets.where('id').above(after)
          : db.sheets.orderBy('id')
        const batch = await collection.limit(REBUILD_BATCH).toArray()
        if (batch.length === 0) {
          break
        }
        const docs = (await Promise.all(batch.map((sheet) => buildSheetDoc(sheet.id)))).filter(
          (doc): doc is SearchDoc => doc !== null,
        )
        // 确定性 docId 主键 + bulkPut：续做重跑同一批只覆盖自身，绝不产生重复条目。
        await db.searchDocs.bulkPut(docs)
        indexed += batch.length
        after = batch[batch.length - 1].id
        meta = await writeMeta({
          phase: 'building',
          stage: 'sheets',
          sheetsAfterId: after,
          indexedSheets: indexed,
          checkpointAt: Date.now(),
        })
        await yieldToEventLoop()
      }
      meta = await writeMeta({ stage: 'places', sheetsAfterId: null })
    }

    // 阶段二：地名 ----------------------------------------------------------
    if (meta.stage === 'places') {
      let after = meta.placesAfterId
      let indexed = meta.indexedPlaces
      for (;;) {
        if (token !== buildToken) {
          return writeMeta({ phase: 'paused', checkpointAt: Date.now() })
        }
        const collection = after
          ? db.placePairs.where('id').above(after)
          : db.placePairs.orderBy('id')
        const batch = await collection.limit(REBUILD_BATCH).toArray()
        if (batch.length === 0) {
          break
        }
        const docs = (await Promise.all(batch.map((pair) => buildPlaceDoc(pair.id)))).filter(
          (doc): doc is SearchDoc => doc !== null,
        )
        await db.searchDocs.bulkPut(docs)
        indexed += batch.length
        after = batch[batch.length - 1].id
        meta = await writeMeta({
          phase: 'building',
          stage: 'places',
          placesAfterId: after,
          indexedPlaces: indexed,
          checkpointAt: Date.now(),
        })
        await yieldToEventLoop()
      }
    }

    // 收尾：把重建期间产生的受影响条目并入视图，再进入可用状态。 --------------
    if (token !== buildToken) {
      return writeMeta({ phase: 'paused', checkpointAt: Date.now() })
    }
    await drainDirty(token)
    if (token !== buildToken) {
      return writeMeta({ phase: 'paused', checkpointAt: Date.now() })
    }
    const idle = await writeMeta({
      phase: 'idle',
      stage: 'done',
      placesAfterId: null,
      error: null,
      updatedAt: Date.now(),
    })
    // idle 落盘与最后一次 drain 之间若有新变化到达，由常规泵再处理一轮。
    void schedulePump()
    return idle
  } catch (error) {
    // 检查点保留原样，错误信息单独记录，恢复后从断点续做而非从头再来。
    const message = error instanceof Error ? error.message : String(error)
    const failed = await writeMeta({ phase: 'error', error: message })
    emit('build-failed', failed)
    return failed
  }
}

/** 取消正在进行的重建：已落检查点保留，之后可续做。 */
export async function cancelBuild(): Promise<void> {
  if (!activeBuild) {
    return
  }
  buildToken += 1
  try {
    const meta = await activeBuild
    if (meta.phase === 'paused') {
      emit('build-cancelled', meta)
    }
  } catch {
    // 取消路径不向调用方抛错。
  }
}

/** 从检查点续做（失败、取消、页面重开后均可调用）。 */
export async function resumeBuild(): Promise<IndexMeta> {
  const meta = await readMeta()
  if (activeBuild) {
    return activeBuild
  }
  if (!meta || meta.phase === 'idle') {
    return (meta ?? defaultMeta())
  }
  return startBuildLoop()
}

// ---- 受影响条目队列（增量重算） -----------------------------------------------

let pumpQueued = false
let pumpTokenLock = Promise.resolve()

/**
 * 源数据变化时登记受影响条目。同一 docId 在队列中只保留一条。
 * 重建进行中入队不打断重建，待收尾阶段统一并入。
 */
export async function touch(root: SearchRoot, sourceId: string): Promise<void> {
  const entry: SearchDirtyEntry = {
    docId: root === 'sheet' ? sheetDocId(sourceId) : placeDocId(sourceId),
    root,
    sourceId,
    enqueuedAt: Date.now(),
  }
  await db.searchDirty.put(entry)
  void schedulePump()
}

/** 图幅变化的级联：图幅文档本身 + 该图幅下全部地名文档（图幅号与扫描件名反规范化在其中）。 */
export async function touchSheetCascade(sheetId: string): Promise<void> {
  await touch('sheet', sheetId)
  const pairIds = await db.placePairs.where('sheetId').equals(sheetId).primaryKeys()
  const now = Date.now()
  await db.searchDirty.bulkPut(
    pairIds.map((id) => ({
      docId: placeDocId(id),
      root: 'place' as const,
      sourceId: id,
      enqueuedAt: now,
    })),
  )
  void schedulePump()
}

/** 地名变化（含新增 / 编辑沿革）：仅重算该地名文档。 */
export async function touchPlace(placePairId: string): Promise<void> {
  await touch('place', placePairId)
}

function schedulePump(): void {
  if (pumpQueued) {
    return
  }
  pumpQueued = true
  pumpTokenLock = pumpTokenLock.then(() => {
    pumpQueued = false
    return pumpOnce().catch(() => {
      // 单条失败不应打断队列；下次变化或重启时继续尝试。
    })
  })
}

async function pumpOnce(): Promise<void> {
  const meta = await readMeta()
  if (!meta || meta.phase !== 'idle') {
    return
  }
  const pending = await db.searchDirty.orderBy('docId').limit(REBUILD_BATCH).toArray()
  if (pending.length === 0) {
    return
  }
  emit('pump-start', meta)
  const docs: SearchDoc[] = []
  for (const entry of pending) {
    const doc = await buildDocFor(entry.root, entry.sourceId)
    if (doc) {
      docs.push(doc)
    }
  }
  // 源条目已删除时移除索引文档；其余按确定性主键覆盖，不添重复。
  const removedDocIds = pending
    .filter((entry) => !docs.some((doc) => doc.docId === entry.docId))
    .map((entry) => entry.docId)
  await db.transaction('rw', db.searchDocs, db.searchDirty, async () => {
    if (docs.length) {
      await db.searchDocs.bulkPut(docs)
    }
    if (removedDocIds.length) {
      await db.searchDocs.bulkDelete(removedDocIds)
    }
    await db.searchDirty.bulkDelete(pending.map((entry) => entry.docId))
  })
  const next = await writeMeta({ docsRev: meta.docsRev + 1, updatedAt: Date.now() })
  emit('pump-done', next)
  // 队列还有剩余则继续让出后处理。
  const remaining = await db.searchDirty.count()
  if (remaining > 0) {
    void schedulePump()
  }
}

/** 重建收尾期间把积压的受影响条目全部并入（此时尚未进入 idle）。 */
async function drainDirty(token: number): Promise<void> {
  for (;;) {
    if (token !== buildToken) {
      return
    }
    const pending = await db.searchDirty.orderBy('docId').limit(REBUILD_BATCH).toArray()
    if (pending.length === 0) {
      return
    }
    const docs: SearchDoc[] = []
    for (const entry of pending) {
      const doc = await buildDocFor(entry.root, entry.sourceId)
      if (doc) {
        docs.push(doc)
      }
    }
    const removedDocIds = pending
      .filter((entry) => !docs.some((doc) => doc.docId === entry.docId))
      .map((entry) => entry.docId)
    await db.transaction('rw', db.searchDocs, db.searchDirty, async () => {
      if (docs.length) {
        await db.searchDocs.bulkPut(docs)
      }
      if (removedDocIds.length) {
        await db.searchDocs.bulkDelete(removedDocIds)
      }
      await db.searchDirty.bulkDelete(pending.map((entry) => entry.docId))
    })
    await yieldToEventLoop()
  }
}

// ---- 视图完整性检查 -----------------------------------------------------------

/**
 * 检查索引视图是否损坏 / 过期：
 * 文档数量与源数据不一致，或存在指向已删除源条目的文档，即判定损坏。
 */
export async function verifyIndex(): Promise<{ ok: boolean; reason?: string }> {
  const meta = await readMeta()
  if (!meta) {
    return { ok: false, reason: '缺少检索索引与检查点' }
  }
  if (meta.phase !== 'idle') {
    return { ok: true }
  }
  const [docCount, sheetCount, placeCount, dirtyCount] = await Promise.all([
    db.searchDocs.count(),
    db.sheets.count(),
    db.placePairs.count(),
    db.searchDirty.count(),
  ])
  if (dirtyCount > 0) {
    return { ok: false, reason: '存在未并入的受影响条目' }
  }
  if (docCount !== sheetCount + placeCount) {
    return { ok: false, reason: '索引条目数与馆藏条目数不一致' }
  }

  const sheetIds = new Set(await db.sheets.orderBy('id').primaryKeys())
  const pairIds = new Set(await db.placePairs.orderBy('id').primaryKeys())
  let after: string | null = null
  for (;;) {
    const collection: import('dexie').Collection<SearchDoc, string, SearchDoc> = after
      ? db.searchDocs.where('docId').above(after)
      : db.searchDocs.orderBy('docId')
    const chunk: SearchDoc[] = await collection.limit(REBUILD_BATCH).toArray()
    if (chunk.length === 0) {
      break
    }
    for (const doc of chunk) {
      if (doc.root === 'sheet' && !sheetIds.has(doc.sourceId)) {
        return { ok: false, reason: '索引中存在已删除图幅的条目' }
      }
      if (doc.root === 'place' && !pairIds.has(doc.sourceId)) {
        return { ok: false, reason: '索引中存在已删除地名的条目' }
      }
    }
    after = chunk[chunk.length - 1].docId
  }
  return { ok: true }
}

/** 首次打开 / 视图损坏后启动：有检查点则续做，损坏则清空分批重建。 */
export async function bootIndex(): Promise<IndexMeta> {
  const meta = await readMeta()
  if (activeBuild) {
    return activeBuild
  }
  if (!meta) {
    return startBuildLoop()
  }
  if (meta.phase === 'idle') {
    const verdict = await verifyIndex()
    if (!verdict.ok) {
      await db.transaction('rw', db.searchDocs, db.searchDirty, db.searchMeta, async () => {
        await db.searchDocs.clear()
        await db.searchDirty.clear()
        await db.searchMeta.put(defaultMeta())
      })
      return startBuildLoop()
    }
    void schedulePump()
    return meta
  }
  // building / paused / error：从检查点续做，不从头开始。
  return startBuildLoop()
}

export async function getIndexMeta(): Promise<IndexMeta> {
  return (await readMeta()) ?? defaultMeta()
}

export type { IndexMeta, IndexPhase, IndexStage }

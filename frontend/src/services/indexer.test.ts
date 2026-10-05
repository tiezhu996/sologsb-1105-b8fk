import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../utils/db'
import {
  cancelIndexBuild,
  ensureIndex,
  INDEX_SCHEMA_REV,
  indexerStatus,
  notifyRemove,
  notifyUpsert,
  rebuildIndex,
  search,
} from './indexer'
import {
  analyzeTerm,
  buildSheetDoc,
  docToTokens,
  highlightTerms,
  splitHighlight,
  tokenizeText,
} from '../utils/searchIndex'
import type { Sheet } from '../types/sheet'

const SEED_TOTAL = 6 + 12 + 12 + 24

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resetDatabase(): Promise<void> {
  db.close()
  await db.delete()
  await db.open()
}

async function waitFor(condition: () => boolean, timeoutMs = 15000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待条件超时')
    }
    await sleep(1)
  }
}

beforeEach(async () => {
  await resetDatabase()
})

describe('分词与高亮', () => {
  it('中文按单字与二元组切词，英文数字按词切词', () => {
    const tokens = tokenizeText('北平-甲-3')
    expect(tokens).toEqual(expect.arrayContaining(['北', '平', '北平', '甲', '3']))
    expect(analyzeTerm('正阳门').exact).toEqual(['正阳', '阳门'])
    expect(analyzeTerm('600dpi').prefixes).toEqual(['600dpi'])
  })

  it('高亮切片与旧版 splitHighlight 行为一致', () => {
    expect(splitHighlight('', '前门')).toEqual([{ text: '', matched: false }])
    expect(splitHighlight('正阳门瓮城', '')).toEqual([{ text: '正阳门瓮城', matched: false }])
    expect(highlightTerms('正阳门瓮城', ['正阳门'])).toEqual([
      { text: '正阳门', matched: true },
      { text: '瓮城', matched: false },
    ])
  })
})

describe('整库构建与关联链检索', () => {
  it('首次构建后索引就绪，文档数与馆藏一致', async () => {
    await ensureIndex()
    expect(indexerStatus.phase).toBe('ready')
    expect(await db.searchDocs.count()).toBe(SEED_TOTAL)
  })

  it('沿图幅号、异写、沿革、扫描件名都能回到关联链', async () => {
    await ensureIndex()

    const byCode = await search('北平-甲-3')
    expect(byCode?.groups[0]?.sheet.id).toBe('sheet-bp-jia-3')
    expect(byCode?.groups[0]?.sheet.matched).toBe(true)

    // 异写命中地名，回到所属图幅
    const byAlias = await search('前门瓮城')
    const aliasGroup = byAlias?.groups.find((group) => group.sheet.id === 'sheet-bp-jia-3')
    expect(aliasGroup?.sheet.matched).toBe(false)
    expect(aliasGroup?.pairs.map((pair) => pair.id)).toContain('place-bp-jia-3-1')

    // 沿革名称命中，嵌回地名与图幅
    const byHistory = await search('丽正门')
    const historyGroup = byHistory?.groups.find((group) => group.sheet.id === 'sheet-bp-jia-3')
    const historyPair = historyGroup?.pairs.find((pair) => pair.id === 'place-bp-jia-3-1')
    expect(historyPair?.histories.map((history) => history.id)).toContain('hist-01')

    // 扫描件名命中，回到所属图幅
    const byScan = await search('蓝图复照')
    const scanGroup = byScan?.groups.find((group) => group.sheet.id === 'sheet-bp-jia-3')
    expect(scanGroup?.scans.map((scan) => scan.id)).toContain('scan-bp-jia-3-2')
    expect(scanGroup?.scanCount).toBe(2)
  })

  it('子串语义与 includes 一致：正阳门瓮城 可被 阳门瓮 命中', async () => {
    await ensureIndex()
    const snapshot = await search('阳门瓮')
    const pairIds = snapshot?.groups.flatMap((group) => group.pairs.map((pair) => pair.id)) ?? []
    expect(pairIds).toContain('place-bp-jia-3-1')
  })
})

describe('分批重建、检查点与续做', () => {
  function makeExtraSheets(count: number): Sheet[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `sheet-load-${index}`,
      code: `压测-${index}`,
      title: `批量图幅 ${index}`,
      year: 1930,
      scale: '1:5000',
      projection: '三角测量',
      sheetSizeCm: '50 × 40 厘米',
      series: '压测图组',
      neighborCodes: [],
      status: '待编',
    }))
  }

  it('取消后保留检查点，续建直至就绪且不添重复条目', async () => {
    const extraSheets = makeExtraSheets(3000)
    await db.sheets.bulkAdd(extraSheets)
    const expectedTotal = SEED_TOTAL + extraSheets.length

    const building = ensureIndex()
    // 同步请求取消：构建循环在提交第一批之前停下，留下检查点
    cancelIndexBuild()
    await building

    const pausedState = await db.searchMeta.get('build')
    expect(pausedState?.status).toBe('building')
    expect(pausedState?.paused).toBe(true)
    expect(pausedState?.done).toBe(0)

    // 从检查点续做直至就绪
    await ensureIndex()
    const readyState = await db.searchMeta.get('build')
    expect(readyState?.status).toBe('ready')
    expect(readyState?.done).toBe(expectedTotal)

    // 文档总数精确等于馆藏条目数：续建没有添入重复条目
    expect(await db.searchDocs.count()).toBe(expectedTotal)
    expect(await db.searchDocs.where('kind').equals('sheet').count()).toBe(6 + extraSheets.length)
    expect(await db.searchDocs.where('kind').equals('scan').count()).toBe(12)
    expect(await db.searchDocs.where('kind').equals('pair').count()).toBe(12)
    expect(await db.searchDocs.where('kind').equals('history').count()).toBe(24)

    const snapshot = await search('压测-777')
    expect(snapshot?.groups.some((group) => group.sheet.id === 'sheet-load-777')).toBe(true)
  }, 30000)

  it('从中间检查点续建：崩溃现场一致，续建不添重复条目', async () => {
    const extraSheets = makeExtraSheets(3000)
    await db.sheets.bulkAdd(extraSheets)
    const expectedTotal = SEED_TOTAL + extraSheets.length

    // 模拟真实崩溃现场：批次与检查点在同一个事务里提交，
    // 因此游标 sheet-load-1499 之前的文档与倒排词已落库，之后的一无所有
    const allSheets = await db.sheets.orderBy('id').toArray()
    const cutoff = allSheets.findIndex((sheet) => sheet.id === 'sheet-load-1499')
    expect(cutoff).toBeGreaterThan(0)
    const committedDocs = allSheets.slice(0, cutoff + 1).map(buildSheetDoc)
    await db.searchDocs.bulkPut(committedDocs)
    await db.searchTokens.bulkPut(committedDocs.flatMap(docToTokens))
    await db.searchMeta.put({
      key: 'build',
      schemaRev: INDEX_SCHEMA_REV,
      status: 'building',
      paused: true,
      tableIndex: 0,
      cursor: 'sheet-load-1499',
      done: cutoff + 1,
      total: expectedTotal,
      generation: 0,
      error: '',
      dirty: [],
    })

    await ensureIndex()

    const readyState = await db.searchMeta.get('build')
    expect(readyState?.status).toBe('ready')
    expect(readyState?.done).toBe(expectedTotal)
    // 续建只补游标之后的条目：总数精确、无重复
    expect(await db.searchDocs.count()).toBe(expectedTotal)
    expect(await db.searchDocs.where('kind').equals('sheet').count()).toBe(6 + extraSheets.length)

    // 抽查续建段一篇文档：倒排行与分词结果一一对应
    const resumed = await db.searchDocs.get('sheet:sheet-load-1550')
    expect(resumed).toBeTruthy()
    const tokenRows = await db.searchTokens.where('docId').equals('sheet:sheet-load-1550').toArray()
    expect(tokenRows.length).toBe(new Set(docToTokens(resumed!).map((row) => row.token)).size)

    const snapshot = await search('压测-1550')
    expect(snapshot?.groups.some((group) => group.sheet.id === 'sheet-load-1550')).toBe(true)
  }, 30000)

  it('整库重建后索引代数递增且结果一致', async () => {
    await ensureIndex()
    const before = await db.searchMeta.get('build')
    await rebuildIndex()
    const after = await db.searchMeta.get('build')
    expect(after?.status).toBe('ready')
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
    expect(await db.searchDocs.count()).toBe(SEED_TOTAL)
  })
})

describe('增量更新与快照语义', () => {
  it('新增条目只重算受影响文档，其余文档保持不动', async () => {
    await ensureIndex()
    const untouchedBefore = await db.searchDocs.get('sheet:sheet-bp-jia-3')
    const generationBefore = (await db.searchMeta.get('build'))?.generation ?? 0

    const sheet: Sheet = {
      id: 'sheet-new-1',
      code: '石家庄-甲-1',
      title: '增量测试图',
      year: 1936,
      scale: '1:5000',
      projection: '三角测量',
      sheetSizeCm: '50 × 40 厘米',
      series: '新增图组',
      neighborCodes: [],
      status: '待编',
    }
    await db.sheets.add(sheet)
    notifyUpsert('sheet', sheet.id)
    await waitFor(() => indexerStatus.generation > generationBefore)

    expect(await db.searchDocs.count()).toBe(SEED_TOTAL + 1)
    expect(await db.searchDocs.get('sheet:sheet-bp-jia-3')).toEqual(untouchedBefore)

    const snapshot = await search('石家庄-甲-1')
    expect(snapshot?.groups[0]?.sheet.id).toBe('sheet-new-1')
  })

  it('同一变更重复提交不产生重复条目', async () => {
    await ensureIndex()
    const sheet: Sheet = {
      id: 'sheet-dup-1',
      code: '重复-1',
      title: '幂等校验图',
      year: 1936,
      scale: '1:5000',
      projection: '三角测量',
      sheetSizeCm: '50 × 40 厘米',
      series: '新增图组',
      neighborCodes: [],
      status: '待编',
    }
    await db.sheets.add(sheet)

    let generation = (await db.searchMeta.get('build'))?.generation ?? 0
    notifyUpsert('sheet', sheet.id)
    await waitFor(() => indexerStatus.generation > generation)

    // 同一变更再次提交（重放）：文档覆盖而非追加
    generation = indexerStatus.generation
    notifyUpsert('sheet', sheet.id)
    await waitFor(() => indexerStatus.generation > generation)

    expect(await db.searchDocs.count()).toBe(SEED_TOTAL + 1)
    const doc = await db.searchDocs.get('sheet:sheet-dup-1')
    const tokenRows = await db.searchTokens.where('docId').equals('sheet:sheet-dup-1').toArray()
    expect(tokenRows.length).toBe(new Set(docToTokens(doc!).map((row) => row.token)).size)
  })

  it('删除条目后对应文档与倒排词一并移除', async () => {
    await ensureIndex()
    const generationBefore = (await db.searchMeta.get('build'))?.generation ?? 0
    await db.histories.delete('hist-01')
    notifyRemove('history', 'hist-01')
    await waitFor(() => indexerStatus.generation > generationBefore)

    expect(await db.searchDocs.get('history:hist-01')).toBeUndefined()
    expect(await db.searchTokens.where('docId').equals('history:hist-01').count()).toBe(0)
    const snapshot = await search('丽正门')
    expect(snapshot?.totalHits ?? 0).toBe(0)
  })

  it('索引未就绪时查询返回 null，由页面保留上一份完整结果', async () => {
    await ensureIndex()
    const ready = await search('北平')
    expect(ready).not.toBeNull()

    // 模拟重建中途：未就绪期间查询不得返回混入新旧的结果
    await db.searchMeta.update('build', { status: 'building' })
    expect(await search('北平')).toBeNull()

    await db.searchMeta.update('build', { status: 'ready' })
    expect(await search('北平')).not.toBeNull()
  })
})

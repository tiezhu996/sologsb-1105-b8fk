/**
 * 本地检索索引集成测试（Node + fake-indexeddb）。
 *
 * 覆盖：首次分批建立、检查点续做、取消后续做不添重复、增量重算、
 * 源条目删除后回收文档、视图损坏判定与重建、沿关联链检索。
 *
 * 运行：npm run test:search
 */
import 'fake-indexeddb/auto'
import { db } from '../src/utils/db'
import type { PlacePair } from '../src/types/placePair'
import type { Sheet } from '../src/types/sheet'
import { searchPage } from '../src/utils/searchEngine'
import {
  bootIndex,
  cancelBuild,
  getIndexMeta,
  rebuild,
  resumeBuild,
  touch,
  touchPlace,
  verifyIndex,
} from '../src/utils/searchIndexer'

let failures = 0
let passed = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('等待条件超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function resetIndex(): Promise<void> {
  await db.searchDocs.clear()
  await db.searchDirty.clear()
  await db.searchMeta.clear()
}

async function pumpSettles(): Promise<void> {
  // 增量泵每批通过 setTimeout 串行，等待队列为空且 docsRev 稳定。
  await waitFor(async () => (await db.searchDirty.count()) === 0)
  await new Promise((resolve) => setTimeout(resolve, 60))
}

async function scenarioFreshBuild(): Promise<void> {
  console.log('\n[1] 首次建立：分批重建、检查点、无重复')
  await resetIndex()
  const meta = await bootIndex()
  check('建立完成后 phase=idle', meta.phase === 'idle', meta.phase)

  const [sheetCount, placeCount, docCount] = await Promise.all([
    db.sheets.count(),
    db.placePairs.count(),
    db.searchDocs.count(),
  ])
  check(
    '文档数与源条目数一致',
    docCount === sheetCount + placeCount,
    `docs=${docCount} sheets=${sheetCount} places=${placeCount}`,
  )

  const docIds = await db.searchDocs.orderBy('docId').primaryKeys()
  check('文档主键无重复', new Set(docIds).size === docIds.length)

  const verdict = await verifyIndex()
  check('完整性校验通过', verdict.ok, verdict.reason ?? '')
}

async function scenarioChainSearch(): Promise<void> {
  console.log('\n[2] 沿图幅号 / 古名 / 沿革 / 扫描件名检索关联链')

  const byHistory = await searchPage('丽正门', { limit: 50 })
  const historyHit = byHistory.hits.find((hit) => hit.doc.sourceId === 'place-bp-jia-3-1')
  check('沿革名「丽正门」命中对应地名文档', Boolean(historyHit))
  check(
    '沿革命中水合出关联图幅',
    historyHit?.chain.sheetCode === '北平-甲-3',
    historyHit?.chain.sheetCode,
  )
  check(
    '沿革命中文本标注沿革字段',
    Boolean(historyHit?.matchedFields.some((field) => field.field === '沿革')),
  )

  const byScanName = await searchPage('原图_600dpi', { limit: 50 })
  check(
    '扫描件名命中图幅与该图幅地名',
    byScanName.hits.some((hit) => hit.doc.sourceId === 'sheet-bp-jia-3') &&
      byScanName.hits.some((hit) => hit.doc.sourceId === 'place-bp-jia-3-1'),
    `命中数 ${byScanName.hits.length}`,
  )
  const scanPlaceHit = byScanName.hits.find((hit) => hit.doc.sourceId === 'place-bp-jia-3-1')
  check(
    '地名命中文档带回扫描件名关联链',
    Boolean(scanPlaceHit?.chain.scanFileNames.some((name) => name.includes('600dpi'))),
  )

  const byCode = await searchPage('保定', { limit: 50 })
  check(
    '图幅号「保定」命中图幅及图下地名',
    byCode.hits.some((hit) => hit.doc.sourceId === 'sheet-bd-zhong-4') &&
      byCode.hits.some((hit) => hit.doc.sourceId === 'place-bd-zhong-4-1'),
  )

  const byAlias = await searchPage('哈德门', { limit: 50 })
  check(
    '异写「哈德门」命中崇文门大街',
    byAlias.hits.some((hit) => hit.doc.sourceId === 'place-bp-jia-3-2'),
  )
}

async function scenarioIncremental(): Promise<void> {
  console.log('\n[3] 变化时只重算受影响条目')

  const before = await getIndexMeta()
  const newSheet: Sheet = {
    id: 'sheet-test-inc',
    code: '测试-增-1',
    title: '增量重算验证图',
    year: 1949,
    scale: '1:5000',
    projection: '平面图',
    sheetSizeCm: '10 × 10 厘米',
    series: '测试图组',
    neighborCodes: [],
    status: '待编',
  }
  await db.sheets.add(newSheet)
  await touch('sheet', newSheet.id)
  await pumpSettles()

  const afterTouchSheet = await getIndexMeta()
  check('单条变化后 docsRev 递增', afterTouchSheet.docsRev === before.docsRev + 1)
  const newDoc = await db.searchDocs.get('sheet:sheet-test-inc')
  check('新图幅只新增自身文档', Boolean(newDoc) && newDoc?.root === 'sheet')
  check(
    '图幅文档含图幅号字段',
    Boolean(newDoc?.fields.some((field) => field.field === '图幅号' && field.text === '测试-增-1')),
  )

  const newPair: PlacePair = {
    id: 'place-test-inc-1',
    sheetId: newSheet.id,
    oldName: '增量旧名',
    newName: '增量新名',
    aliasList: ['增量异写'],
    placeType: '村镇',
    coordNote: '测试方位',
    certainty: '确定',
  }
  await db.placePairs.add(newPair)
  await touchPlace(newPair.id)
  await pumpSettles()
  const pairDoc = await db.searchDocs.get('place:place-test-inc-1')
  check(
    '新地名文档沿外键带回图幅号与关联链',
    Boolean(
      pairDoc?.fields.some((field) => field.field === '图幅号' && field.text === '测试-增-1'),
    ),
  )

  // 再次 touch 已有条目：覆盖而非新增。
  const countBefore = await db.searchDocs.count()
  await touchPlace(newPair.id)
  await pumpSettles()
  const countAfter = await db.searchDocs.count()
  check('重复重算不添重复条目', countAfter === countBefore)

  // 删除源条目：脏队列重算应回收对应文档。
  await db.placePairs.delete(newPair.id)
  await touchPlace(newPair.id)
  await pumpSettles()
  check('删除地名后索引文档被回收', !(await db.searchDocs.get('place:place-test-inc-1')))

  await db.sheets.delete(newSheet.id)
  await touch('sheet', newSheet.id)
  await pumpSettles()
  check('删除图幅后索引文档被回收', !(await db.searchDocs.get('sheet:sheet-test-inc')))
}

async function scenarioManualCheckpoint(): Promise<void> {
  console.log('\n[4] 模拟中断检查点：续做不重复、不重头')
  await resetIndex()

  // 先完整建立一次，取一个中段地名 id，人为构造成「建到一半」的检查点。
  await bootIndex()
  const sheetIds = await db.sheets.orderBy('id').primaryKeys()
  const pairIds = await db.placePairs.orderBy('id').primaryKeys()
  const middleIndex = Math.floor(pairIds.length / 2)
  const middleId = pairIds[middleIndex]
  // 真实中断时此前批次已提交的文档仍在表中：保留全部图幅文档与中段之前的地名文档。
  const keptDocs = await db.searchDocs
    .filter(
      (doc) => doc.root === 'sheet' || (doc.root === 'place' && pairIds.indexOf(doc.sourceId) <= middleIndex),
    )
    .toArray()
  check(
    '测试前置：检查点前已落盘文档数与游标一致',
    keptDocs.length === sheetIds.length + middleIndex + 1,
    `kept=${keptDocs.length}`,
  )
  await db.searchDocs.clear()
  await db.searchDocs.bulkPut(keptDocs)
  await db.searchMeta.put({
    key: 'index',
    phase: 'paused',
    stage: 'places',
    sheetsAfterId: null,
    placesAfterId: middleId,
    indexedSheets: sheetIds.length,
    indexedPlaces: middleIndex + 1,
    totalSource: pairIds.length + sheetIds.length,
    checkpointAt: Date.now(),
    updatedAt: null,
    error: null,
    docsRev: 0,
  })

  const resumed = await resumeBuild()
  check('从检查点续做后完成', resumed.phase === 'idle', resumed.phase)
  check('续做后游标归零', resumed.placesAfterId === null && resumed.sheetsAfterId === null)

  const [sheetCount, placeCount, docCount] = await Promise.all([
    db.sheets.count(),
    db.placePairs.count(),
    db.searchDocs.count(),
  ])
  check(
    '续做后文档总数精确、无重复',
    docCount === sheetCount + placeCount,
    `docs=${docCount} expect=${sheetCount + placeCount}`,
  )
}

async function scenarioCancelLargeRebuild(): Promise<void> {
  console.log('\n[5] 大批量下取消：检查点保留，续做完成')

  // 追加 4000 条地名，保证每批让出事件循环期间可以被取消。
  const existingPairs = await db.placePairs.count()
  const bulk: PlacePair[] = Array.from({ length: 4000 }, (_, index) => ({
    id: `place-bulk-${index}`,
    sheetId: 'sheet-bp-jia-3',
    oldName: `压测旧名${index}`,
    newName: `压测新名${index}`,
    aliasList: [],
    placeType: '村镇',
    coordNote: '压测方位',
    certainty: '确定',
  }))
  await db.placePairs.bulkAdd(bulk)

  await resetIndex()
  const buildPromise = rebuild()
  await waitFor(async () => (await getIndexMeta()).phase === 'building', 5000)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await cancelBuild()
  const paused = await buildPromise
  check('取消后 phase=paused 且检查点保留', paused.phase === 'paused', paused.phase)
  const docCountWhilePaused = await db.searchDocs.count()
  const totalSource = (await db.sheets.count()) + (await db.placePairs.count())
  check(
    '取消时只写入了部分批次',
    docCountWhilePaused > 0 && docCountWhilePaused < totalSource,
    `written=${docCountWhilePaused} total=${totalSource}`,
  )

  const resumed = await resumeBuild()
  check('续做完成 phase=idle', resumed.phase === 'idle', resumed.phase)
  const finalCount = await db.searchDocs.count()
  check(
    '续做后文档数精确',
    finalCount === totalSource,
    `docs=${finalCount} total=${totalSource}`,
  )
  const ids = await db.searchDocs.orderBy('docId').primaryKeys()
  check('续做后无重复主键', new Set(ids).size === ids.length)

  // 压测数据下检索仍可用且内存有界（只取一页）。
  const page = await searchPage('压测旧名', { limit: 20, roots: ['place'] })
  check('压测关键词 total 统计正确', page.total === 4000, `total=${page.total}`)
  check('分页只水合一页（20 条）', page.hits.length === 20)

  // 清理压测数据并重建，恢复干净库。
  await db.placePairs.where('id').startsWith('place-bulk-').delete()
  await resetIndex()
  await bootIndex()
  check('清理后恢复', (await db.placePairs.count()) === existingPairs)
}

async function scenarioCorruption(): Promise<void> {
  console.log('\n[6] 视图损坏：检测到后分批重建')
  // 手动插入一条指向不存在源条目的孤儿文档。
  await db.searchDocs.put({
    docId: 'place:ghost-doc',
    root: 'place',
    sourceId: 'ghost-pair',
    sheetId: 'ghost-sheet',
    haystack: 'ghost',
    fields: [{ field: '古名', text: 'ghost' }],
    updatedAt: Date.now(),
  })
  const badVerdict = await verifyIndex()
  check('能检出孤儿文档（视图损坏）', !badVerdict.ok, badVerdict.reason ?? '未检出')

  const meta = await bootIndex()
  check('损坏后自动重建完成', meta.phase === 'idle', meta.phase)
  check('孤儿文档被清除', !(await db.searchDocs.get('place:ghost-doc')))
  const goodVerdict = await verifyIndex()
  check('重建后完整性恢复', goodVerdict.ok, goodVerdict.reason ?? '')
}

async function main(): Promise<void> {
  try {
    await scenarioFreshBuild()
    await scenarioChainSearch()
    await scenarioIncremental()
    await scenarioManualCheckpoint()
    await scenarioCancelLargeRebuild()
    await scenarioCorruption()
  } finally {
    db.close()
  }

  console.log(`\n结果：${passed} 通过，${failures} 失败`)
  if (failures > 0) {
    process.exitCode = 1
  }
}

void main()

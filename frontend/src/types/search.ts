/**
 * 本地检索索引的数据模型。
 *
 * 索引全部落在 IndexedDB（见 utils/db.ts version(3)），内存里只保留
 * 当前这一份查询结果快照，避免馆藏数千条时把全量数据读进内存。
 */

/** 被索引的实体类别：图幅 / 扫描件 / 地名对照 / 沿革 */
export type SearchKind = 'sheet' | 'scan' | 'pair' | 'history'

/** 文档中一个可检索字段，label 用于结果页展示命中位置 */
export interface SearchField {
  label: string
  text: string
}

/**
 * 检索文档。每个源实体对应一条，id 为 `${kind}:${entityId}`，
 * 按主键 put 覆盖，因此断点续建、重放批次都不会产生重复条目。
 */
export interface SearchDoc {
  id: string
  kind: SearchKind
  entityId: string
  /** 关联链根：所属图幅 id（图幅自身则为自身 id） */
  sheetId: string
  /** 上一级：scan/pair 为 sheetId，history 为 placePairId，sheet 为空串 */
  parentId: string
  /** 结果页主标题（图幅号 / 扫描件名 / 古名 / 沿革名） */
  primary: string
  /** 结果页副标题（题名 / 今名 / 年代等） */
  secondary: string
  fields: SearchField[]
}

/** 倒排索引行，主键 [token+docId]，重复写入天然去重 */
export interface SearchToken {
  token: string
  docId: string
}

/** 建库期间收到、待收尾时统一应用的增量变更 */
export interface IndexChange {
  kind: SearchKind
  id: string
  deleted?: boolean
}

/**
 * 索引构建状态（searchMeta 表中单行，key = 'build'）。
 * 每批提交后更新 cursor/done 作为检查点；失败或取消后据此续做。
 */
export interface BuildState {
  key: string
  schemaRev: number
  status: 'building' | 'ready'
  /** 取消或出错后为 true，等待人工续做 */
  paused: boolean
  /** 当前重建到第几张源表 */
  tableIndex: number
  /** 当前表内已处理到的主键游标 */
  cursor: string | null
  done: number
  total: number
  /** 已提交索引的代数，每提交一批变更递增 */
  generation: number
  error: string
  dirty: IndexChange[]
}

/** 命中字段的一段高亮切片 */
export interface HighlightPart {
  text: string
  matched: boolean
}

export interface FieldMatch {
  label: string
  parts: HighlightPart[]
}

export interface SheetHit {
  id: string
  code: string
  title: string
  year: string
  matched: boolean
  fields: FieldMatch[]
}

export interface ScanHit {
  id: string
  fileName: string
  fields: FieldMatch[]
}

export interface HistoryHit {
  id: string
  period: string
  name: string
  fields: FieldMatch[]
}

export interface PairHit {
  id: string
  oldName: string
  newName: string
  /** 地名本身未命中、仅沿革命中时为空数组 */
  fields: FieldMatch[]
  histories: HistoryHit[]
}

/** 一条关联链分组：图幅为根，下挂命中的扫描件与地名（地名再挂沿革） */
export interface SearchHitGroup {
  sheet: SheetHit
  scanCount: number
  pairCount: number
  scans: ScanHit[]
  pairs: PairHit[]
}

/**
 * 一份完整的查询结果快照。页面只有在整份算完后才整体替换旧快照，
 * 替换前继续展示上一份并标记「更新中」，不会混入新旧条目。
 */
export interface SearchSnapshot {
  query: string
  generation: number
  finishedAt: number
  totalHits: number
  truncated: boolean
  groups: SearchHitGroup[]
}

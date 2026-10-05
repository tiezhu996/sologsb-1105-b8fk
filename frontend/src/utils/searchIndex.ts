import type { NameHistory } from '../types/history'
import type { PlacePair } from '../types/placePair'
import type { ScanItem } from '../types/scan'
import type { HighlightPart, SearchDoc, SearchToken } from '../types/search'
import type { Sheet } from '../types/sheet'

/**
 * 分词与高亮的纯函数集合，不触碰 IndexedDB，便于独立验证。
 *
 * 中文按单字 + 二元组（bigram）切词，英文数字按连续词切词；
 * 查询时用同样的规则切词后取倒排交集，再回到文档字段上做
 * includes 复核，保证语义与原先的子串匹配完全一致。
 */

const WORD_RUN = /[a-z0-9]+/g
// CJK 扩展 A 区、基本区与兼容表意文字区
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g

export function tokenizeText(text: string): string[] {
  const normalized = text.toLocaleLowerCase()
  const tokens = new Set<string>()

  for (const match of normalized.matchAll(WORD_RUN)) {
    tokens.add(match[0])
  }

  const cjkRuns = normalized.match(CJK_RUN) ?? []
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length; index += 1) {
      tokens.add(run[index])
      if (index + 1 < run.length) {
        tokens.add(run.slice(index, index + 2))
      }
    }
  }

  return [...tokens]
}

export interface TermTokens {
  /** 中文单字 / 二元组，精确等值查倒排 */
  exact: string[]
  /** 英文数字词，按前缀查倒排（输入 "600d" 也能命中 "600dpi"） */
  prefixes: string[]
}

export function analyzeTerm(term: string): TermTokens {
  const normalized = term.toLocaleLowerCase()
  const exact: string[] = []
  const prefixes: string[] = []

  for (const match of normalized.matchAll(WORD_RUN)) {
    prefixes.push(match[0])
  }

  const cjkRuns = normalized.match(CJK_RUN) ?? []
  for (const run of cjkRuns) {
    if (run.length === 1) {
      exact.push(run)
    } else {
      for (let index = 0; index + 1 < run.length; index += 1) {
        exact.push(run.slice(index, index + 2))
      }
    }
  }

  return { exact, prefixes }
}

/** 把一段文本按多个命中词切片，供 <mark> 高亮渲染 */
export function highlightTerms(text: string, terms: string[]): HighlightPart[] {
  const lowered = text.toLocaleLowerCase()
  const intervals: Array<[number, number]> = []

  for (const term of terms) {
    const needle = term.toLocaleLowerCase().trim()
    if (!needle) {
      continue
    }
    let from = lowered.indexOf(needle)
    while (from >= 0) {
      intervals.push([from, from + needle.length])
      from = lowered.indexOf(needle, from + needle.length)
    }
  }

  if (intervals.length === 0) {
    return [{ text, matched: false }]
  }

  intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const merged: Array<[number, number]> = []
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  const parts: HighlightPart[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), matched: false })
    }
    parts.push({ text: text.slice(start, end), matched: true })
    cursor = end
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), matched: false })
  }
  return parts
}

/** 单词条高亮，保持与旧版 usePlaceSearch.splitHighlight 相同的行为 */
export function splitHighlight(text: string, keyword: string): HighlightPart[] {
  return highlightTerms(text, [keyword])
}

export function buildSheetDoc(sheet: Sheet): SearchDoc {
  return {
    id: `sheet:${sheet.id}`,
    kind: 'sheet',
    entityId: sheet.id,
    sheetId: sheet.id,
    parentId: '',
    primary: sheet.code,
    secondary: sheet.title,
    fields: [
      { label: '图幅号', text: sheet.code },
      { label: '题名', text: sheet.title },
      { label: '图组', text: sheet.series },
      { label: '投影', text: sheet.projection },
      { label: '年代', text: String(sheet.year) },
      { label: '比例尺', text: sheet.scale },
      { label: '状态', text: sheet.status },
    ],
  }
}

export function buildScanDoc(scan: ScanItem): SearchDoc {
  return {
    id: `scan:${scan.id}`,
    kind: 'scan',
    entityId: scan.id,
    sheetId: scan.sheetId,
    parentId: scan.sheetId,
    primary: scan.fileName,
    secondary: scan.storageNote,
    fields: [
      { label: '扫描件名', text: scan.fileName },
      { label: '存放位置', text: scan.storageNote },
      { label: '色彩', text: scan.colorMode },
      { label: '质量', text: scan.quality },
      { label: '分辨率', text: `${scan.resolutionDpi}dpi` },
    ],
  }
}

export function buildPairDoc(pair: PlacePair): SearchDoc {
  return {
    id: `pair:${pair.id}`,
    kind: 'pair',
    entityId: pair.id,
    sheetId: pair.sheetId,
    parentId: pair.sheetId,
    primary: pair.oldName,
    secondary: pair.newName,
    fields: [
      { label: '古名', text: pair.oldName },
      { label: '新名', text: pair.newName },
      ...pair.aliasList.map((alias) => ({ label: '异写', text: alias })),
      { label: '图上方位', text: pair.coordNote },
      { label: '类型', text: pair.placeType },
      { label: '确定度', text: pair.certainty },
    ],
  }
}

export function buildHistoryDoc(history: NameHistory, sheetId: string): SearchDoc {
  return {
    id: `history:${history.id}`,
    kind: 'history',
    entityId: history.id,
    sheetId,
    parentId: history.placePairId,
    primary: history.name,
    secondary: history.period,
    fields: [
      { label: '沿革名称', text: history.name },
      { label: '年代', text: history.period },
      { label: '出处', text: history.sourceRef },
      { label: '变化', text: history.changeType },
      { label: '备注', text: history.note },
    ],
  }
}

/** 从文档全部字段提取倒排词行 */
export function docToTokens(doc: SearchDoc): SearchToken[] {
  const tokens = new Set<string>()
  for (const field of doc.fields) {
    for (const token of tokenizeText(field.text)) {
      tokens.add(token)
    }
  }
  return [...tokens].map((token) => ({ token, docId: doc.id }))
}

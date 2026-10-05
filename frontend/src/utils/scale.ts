import type { SheetScale } from '../types/sheet'

const DYNASTY_ORDER: Record<string, number> = {
  先秦: -1,
  秦: 1,
  汉: 2,
  魏: 3,
  晋: 4,
  隋: 5,
  唐: 6,
  五代: 7,
  宋: 8,
  辽: 8,
  金: 8,
  元: 9,
  明: 10,
  清: 11,
  民国: 12,
  中华人民共和国: 13,
}

export interface SheetSpanEstimate {
  widthKm: number
  heightKm: number
  longitudeSpan: string
  latitudeSpan: string
}

export function scaleToText(scale: SheetScale): string {
  if (scale === '1:5000') {
    return '五千分之一 · 城区细部'
  }
  return '五万分之一 · 区域总图'
}

export function estimateSheetSpan(scale: SheetScale, sheetSizeCm: string): SheetSpanEstimate {
  const denominator = Number(scale.split(':')[1])
  const dimensions = sheetSizeCm.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [50, 40]
  const widthCm = dimensions[0] ?? 50
  const heightCm = dimensions[1] ?? widthCm
  const widthKm = (widthCm / 100000) * denominator
  const heightKm = (heightCm / 100000) * denominator
  const longitude = (widthKm / 100).toFixed(2)
  const latitude = (heightKm / 111).toFixed(2)

  return {
    widthKm: Number(widthKm.toFixed(2)),
    heightKm: Number(heightKm.toFixed(2)),
    longitudeSpan: `${longitude}°`,
    latitudeSpan: `${latitude}°`,
  }
}

export function parsePeriodYear(period: string): number {
  const explicitYear = period.match(/(?:17|18|19|20)\d{2}/)
  if (explicitYear?.[0]) {
    return Number(explicitYear[0])
  }

  const shortYear = period.match(/\d{3,4}/)
  if (shortYear?.[0]) {
    return Number(shortYear[0])
  }

  for (const [dynasty, order] of Object.entries(DYNASTY_ORDER)) {
    if (period.includes(dynasty)) {
      return order * 1000
    }
  }

  return Number.MAX_SAFE_INTEGER
}

export function sortByPeriod<T extends { period: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const yearDifference = parsePeriodYear(left.period) - parsePeriodYear(right.period)
    if (yearDifference !== 0) {
      return yearDifference
    }
    return left.period.localeCompare(right.period, 'zh-CN')
  })
}

export function sortByYear<T extends { year: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.year - right.year)
}

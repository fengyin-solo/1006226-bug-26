import { cleaningRecords, listRows } from '@/data/local-store'
import { GO_LIVE_DATE } from '@/data/seed-cleaning'
import { gapNotes, compareCalibers } from '@/domain/ledger'
import type { CleaningRecord, EntryRow } from '@/data/types'

function allRackRows(): EntryRow[] {
  return listRows('trashrack')
}

// 拦污栅业务口径集中处：压差超限阈值、待清理名单、优先次序、汇总都从这里出，
// 列表页、清污次序视图、另存清单、概览与跨模块台账读到的是同一份。

/** 压差报警阈值（米水柱），达到即为超限。 */
export const PRESSURE_LIMIT = 2.5

/** 确认完成清污后压差回到该栅体的静态压差（近净态值）。 */
export function pressureAfterCleaning(rack: EntryRow): number {
  const staticPressure = Number(rack['静态压差'])
  return Number.isFinite(staticPressure) && staticPressure > 0 ? staticPressure : 0.8
}

export function pressureOf(row: EntryRow): number {
  const value = Number(row['前后压差'])
  return Number.isFinite(value) ? value : 0
}

/** 是否超限：前后压差达到阈值。已损坏另有异常标记，不重复算超限。 */
export function isOverLimit(row: EntryRow): boolean {
  return String(row.status) !== '已损坏' && pressureOf(row) >= PRESSURE_LIMIT
}

/** 待清理名单：只含「待清理 / 清理中」，已清理、已损坏的栅体不留在名单里。 */
export function pendingRacks(rows: EntryRow[] = []): EntryRow[] {
  const source = rows.length ? rows : allRackRows()
  return source.filter((row) => ['待清理', '清理中'].includes(String(row.status)))
}

/**
 * 清污优先次序：同一口径按压差从大到小排；压差相同按栅体编号兜底，次序稳定。
 * 清污完成、压差重算后顺序随之变化，已清理的栅体自然移出名单。
 */
export function cleaningQueue(rows: EntryRow[] = []): EntryRow[] {
  return pendingRacks(rows)
    .map((row) => ({ row, pressure: pressureOf(row) }))
    .sort((a, b) => {
      if (b.pressure !== a.pressure) return b.pressure - a.pressure
      return String(a.row['栅体编号']).localeCompare(String(b.row['栅体编号']))
    })
    .map((item) => item.row)
}

export function recordsOfRack(rackId: number): CleaningRecord[] {
  return cleaningRecords()
    .filter((item) => item.rackId === rackId)
    .sort((a, b) => a.cleanDate.localeCompare(b.cleanDate))
}

export function latestRecordOfRack(rackId: number): CleaningRecord | undefined {
  return recordsOfRack(rackId).at(-1)
}

/** 清污次数以清污记录为准重算，栅体字段只是投影：重复确认不会多算。 */
export function cleaningCountOfRack(rackId: number): number {
  return recordsOfRack(rackId).length
}

export type TrashrackSummary = {
  pendingCount: number
  cleanedCount: number
  damagedCount: number
  overLimitCount: number
  maxPressure: number
  cleaningTotal: number
}

export function summarizeTrashrack(rows: EntryRow[] = []): TrashrackSummary {
  const source = rows.length ? rows : allRackRows()
  const pressures = source.map(pressureOf)
  return {
    pendingCount: pendingRacks(source).length,
    cleanedCount: source.filter((row) => String(row.status) === '已清理').length,
    damagedCount: source.filter((row) => String(row.status) === '已损坏').length,
    overLimitCount: source.filter(isOverLimit).length,
    maxPressure: pressures.length ? Math.max(...pressures) : 0,
    cleaningTotal: cleaningRecords().length,
  }
}

/** 早于平台上线日的清污日期判定，供页面标注「补录」。 */
export function isBackfillDate(date: string): boolean {
  return date < GO_LIVE_DATE
}

/** 拦污栅模块下的早年缺项说明。 */
export function rackGapNotes() {
  return gapNotes('trashrack')
}

/**
 * 两套口径比对：运行台账清污条数（权威）vs 栅体清污次数字段合计（留痕）。
 * 正常情况下两者恒等；一旦手工改坏状态字段，这里能立刻暴露不一致。
 */
export function compareRackCalibers(
  rows: EntryRow[] = [],
  records: CleaningRecord[] = cleaningRecords(),
) {
  const source = rows.length ? rows : allRackRows()
  const trace = source.reduce((sum, row) => sum + (Number(row['清污次数']) || 0), 0)
  return compareCalibers(records.length, trace)
}

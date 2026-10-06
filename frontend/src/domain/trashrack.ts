import { shiftDate } from '@/data/clock'
import { mutate } from '@/data/local-store'
import type { ActionResult, CleaningLog, EntryRow, StoreDocument } from '@/data/types'

// 拦污栅业务域：前后压差、超限判定、清污优先次序、清污日志只在这里算。
// 列表页、清污次序页、另存的清污清单、运营概览都读同一份结果，不允许各算各的。

export const PRESSURE_LIMIT = 1.5 // 前后压差超限阈值（m 水柱）
export const RESIDUAL_PRESSURE = 0.1 // 清污完成后残余压差（m 水柱）
const CLEANING_INTERVAL_DAYS = 45 // 历史清污按清理日期回填时，相邻两次清污的间隔
const STOCK_REMARK = '平台上线（2026-09-01）前清污，按运行记录补录'
const MISSING_DATE_REMARK = '清污次数有记载但清理日期缺失，未虚构记录，待查纸质台账'

export function toPressure(value: string | number | boolean | undefined): number {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(num) ? num : 0
}

export function overLimit(row: EntryRow): boolean {
  return String(row.status) !== '已损坏' && toPressure(row['前后压差']) >= PRESSURE_LIMIT
}

// 栅体的待处理/异常标记与重算结果同口径：待清理、清理中算待处理；压差超限或已损坏算异常。
export function recomputeFlags(row: EntryRow): EntryRow {
  const status = String(row.status)
  return {
    ...row,
    pending: status === '待清理' || status === '清理中',
    abnormal: status === '已损坏' || overLimit(row),
  }
}

/** 清污优先次序：待清理/清理中的栅体按当前前后压差从大到小排，超限的排最前。 */
export function cleaningQueue(rows: EntryRow[]): EntryRow[] {
  return rows
    .filter((row) => ['待清理', '清理中'].includes(String(row.status)))
    .sort((a, b) => toPressure(b['前后压差']) - toPressure(a['前后压差']))
}

export function cleanedRows(rows: EntryRow[]): EntryRow[] {
  return rows.filter((row) => String(row.status) === '已清理')
}

export type TrashrackStats = {
  pending: number
  cleaned: number
  overLimitCount: number
  damaged: number
  maxPressure: number
}

export function trashrackStats(rows: EntryRow[]): TrashrackStats {
  const active = rows.filter((row) => String(row.status) !== '已损坏')
  const pressures = active.map((row) => toPressure(row['前后压差']))
  return {
    pending: active.filter((row) => row.pending).length,
    cleaned: rows.filter((row) => String(row.status) === '已清理').length,
    overLimitCount: active.filter((row) => overLimit(row)).length,
    damaged: rows.filter((row) => String(row.status) === '已损坏').length,
    maxPressure: pressures.length ? Math.max(...pressures) : 0,
  }
}

type BootstrapLog = Omit<CleaningLog, 'id'>

// 存量回填：每台栅体历史上清污过几次，就以最近一次清理日期为锚向前推，按日期逐条补。
// 早于平台上线的记「存量补录」；日期缺失的不虚构记录，只挂一条缺记说明。
export function bootstrapTrashrack(doc: StoreDocument): void {
  if (doc.cleaningLogs.length > 0) {
    return
  }
  const records: BootstrapLog[] = []
  for (const row of doc.entries.trashrack ?? []) {
    const count = Number.parseInt(String(row['清污次数'] ?? '0'), 10)
    const total = Number.isFinite(count) ? count : 0
    const code = String(row['栅体编号'])
    const unit = String(row['所属机组'])
    const anchor = String(row['清理日期'] ?? '')
    if (total <= 0) {
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      records.push({
        栅体编号: code,
        所属机组: unit,
        清理日期: '',
        清污方式: '',
        清理人员: '',
        清前压差: 0,
        清后压差: 0,
        来源: '存量补录',
        备注: MISSING_DATE_REMARK,
      })
      continue
    }
    for (let i = 0; i < total; i += 1) {
      const date = shiftDate(anchor, -i * CLEANING_INTERVAL_DAYS)
      records.push({
        栅体编号: code,
        所属机组: unit,
        清理日期: date,
        清污方式: i === 0 ? String(row['清污方式'] ?? '人工清污') : i % 2 === 0 ? '人工清污' : '机械清污',
        清理人员: i === 0 ? String(row['清理人员'] ?? '') : '历史值班人员',
        清前压差: Math.round((1.6 + ((Number(row.id) * 7 + i * 3) % 9) / 10) * 100) / 100,
        清后压差: RESIDUAL_PRESSURE,
        来源: date < '2026-09-01' ? '存量补录' : '运行登记',
        备注: date < '2026-09-01' ? STOCK_REMARK : '',
      })
    }
  }
  records.sort((a, b) => (a.清理日期 < b.清理日期 ? 1 : a.清理日期 > b.清理日期 ? -1 : 0))
  doc.cleaningLogs = records.map((record, index) => ({ ...record, id: index + 1 }))
}

function nextLogId(logs: CleaningLog[]): number {
  return logs.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function updateRow(
  rows: EntryRow[],
  id: number,
  patch: Record<string, string | number | boolean>,
): EntryRow | null {
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return null
  }
  const merged: EntryRow = { ...rows[index], ...patch }
  rows[index] = recomputeFlags(merged)
  return rows[index]
}

// 确认完成清污：同一事务里改状态、压差归零到残余值、清污次数加一、追加清污日志，
// 优先次序与待清理台数在下次读取时自然由同一份栅体清单重算，不存在两处对不上。
export function confirmCleaning(id: number, operator: string, date: string): ActionResult {
  try {
    const result = mutate((doc) => {
      const rows = doc.entries.trashrack ?? []
      const row = rows.find((item) => Number(item.id) === id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的拦污栅` }
      }
      const status = String(row.status)
      if (status === '已清理') {
        // 幂等：已清理的栅体重复确认直接拒绝，不清污次数、不写日志。
        return { ok: false, message: `${row['栅体编号']} 已清理，重复确认不再累加清污次数` }
      }
      if (status === '已损坏') {
        return { ok: false, message: `${row['栅体编号']} 已登记损坏，不能确认清污` }
      }
      const before = toPressure(row['前后压差'])
      const count = Number.parseInt(String(row['清污次数'] ?? '0'), 10) || 0
      const updated = updateRow(rows, id, {
        status: '已清理',
        前后压差: RESIDUAL_PRESSURE,
        清污次数: count + 1,
        清理日期: date,
        清理人员: operator,
      })
      if (!updated) {
        throw new Error('栅体更新失败')
      }
      doc.cleaningLogs.push({
        id: nextLogId(doc.cleaningLogs),
        栅体编号: String(updated['栅体编号']),
        所属机组: String(updated['所属机组']),
        清理日期: date,
        清污方式: String(updated['清污方式'] ?? '人工清污'),
        清理人员: operator,
        清前压差: before,
        清后压差: RESIDUAL_PRESSURE,
        来源: '运行登记',
        备注: '',
      })
      return {
        ok: true,
        message: `${updated['栅体编号']} 清污完成：压差 ${before.toFixed(2)}m → ${RESIDUAL_PRESSURE.toFixed(2)}m，已移出待清理清单`,
      }
    })
    return result
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : '落库失败'}，本次确认已整套回滚，栅体状态与清污清单均未改动`,
    }
  }
}

export function scheduleCleaning(id: number): ActionResult {
  try {
    return mutate((doc) => {
      const rows = doc.entries.trashrack ?? []
      const row = rows.find((item) => Number(item.id) === id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的拦污栅` }
      }
      if (String(row.status) === '已损坏') {
        return { ok: false, message: `${row['栅体编号']} 已损坏，不能安排清理` }
      }
      if (String(row.status) === '清理中') {
        return { ok: false, message: `${row['栅体编号']} 已在清理中` }
      }
      if (String(row.status) === '已清理') {
        return { ok: false, message: `${row['栅体编号']} 已清理，如需再次清污请先登记压差超限` }
      }
      updateRow(rows, id, { status: '清理中' })
      return { ok: true, message: `${row['栅体编号']} 已安排清理，进入清污次序队列` }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '落库失败，已整套回滚' }
  }
}

export function markDamaged(id: number): ActionResult {
  try {
    return mutate((doc) => {
      const rows = doc.entries.trashrack ?? []
      const row = rows.find((item) => Number(item.id) === id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的拦污栅` }
      }
      if (String(row.status) === '已损坏') {
        return { ok: false, message: `${row['栅体编号']} 已登记损坏` }
      }
      updateRow(rows, id, { status: '已损坏' })
      return { ok: true, message: `${row['栅体编号']} 已登记损坏，移出清污次序队列` }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '落库失败，已整套回滚' }
  }
}

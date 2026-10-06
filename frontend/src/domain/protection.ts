import { daysBetween, shiftDate } from '@/data/clock'
import { mutate } from '@/data/local-store'
import type { ActionResult, EntryRow, ProtectionLedgerEntry, StoreDocument } from '@/data/types'

// 继电保护业务域：设备状态以「运行台账」里最新一条受理校验结论为唯一依据，
// 另一份历史结论只作留痕，不参与统计。设备台账、运行台账、运营概览读到的台数同源。

export const DUE_SOON_DAYS = 30 // 距下次校验日 30 天内算「即将到期」
export const CALIBRATION_CYCLE_DAYS = 365
const STOCK_REMARK = '平台上线（2026-09-01）前校验，按校验记录补录'
const MISSING_LEDGER_REMARK = '上线前校验记录缺失，待查纸质校验报告，缺项期间按待校验跟踪'

export type Conclusion = '正常' | '异常'

export function nextLedgerId(ledger: ProtectionLedgerEntry[]): number {
  return ledger.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

// 设备的待处理/异常标记与台账口径一致：待校验算待处理，异常算异常；即将到期也提示待处理。
// 已退出运行的装置不再纳入待处理/异常统计。
export function recomputeProtectionFlags(row: EntryRow, todayValue: string): EntryRow {
  const status = String(row.status)
  if (status === '已退出') {
    return { ...row, pending: false, abnormal: false }
  }
  const dueDays = daysBetween(todayValue, String(row['下次校验日'] ?? '9999-12-31'))
  const dueSoon = Number.isFinite(dueDays) && dueDays <= DUE_SOON_DAYS
  return {
    ...row,
    pending: status === '待校验' || dueSoon,
    abnormal: status === '异常',
  }
}

export type ProtectionStats = {
  inLedger: number
  normal: number
  pendingCalibration: number
  dueSoon: number
  abnormal: number
}

export function protectionStats(rows: EntryRow[], todayValue: string): ProtectionStats {
  return {
    inLedger: rows.length,
    normal: rows.filter((row) => String(row.status) === '正常').length,
    pendingCalibration: rows.filter((row) => String(row.status) === '待校验').length,
    dueSoon: rows.filter((row) => {
      const days = daysBetween(todayValue, String(row['下次校验日'] ?? ''))
      return Number.isFinite(days) && days <= DUE_SOON_DAYS
    }).length,
    abnormal: rows.filter((row) => String(row.status) === '异常').length,
  }
}

/** 以运行台账为准：设备状态取该装置最新一条「受理」校验结论；没有受理结论则保持待校验。 */
export function deriveStatus(row: EntryRow, ledger: ProtectionLedgerEntry[]): string {
  const accepted = ledger
    .filter((item) => item.接收状态 === '受理' && item.装置编号 === String(row['装置编号']))
    .sort((a, b) => (a.记录时间 < b.记录时间 ? 1 : a.记录时间 > b.记录时间 ? -1 : b.id - a.id))
  return accepted.length ? accepted[0].校验结论 : '待校验'
}

// 存量回填：按记录时间给每台装置补一条上线前的受理校验结论；
// 早年缺项的不编造，只登记一条「缺项说明」，设备按待校验跟踪。
export function bootstrapProtection(doc: StoreDocument): void {
  if (doc.protectionLedger.length > 0) {
    return
  }
  const ledger: ProtectionLedgerEntry[] = []
  for (const row of doc.entries.protection ?? []) {
    const code = String(row['装置编号'])
    const lastDate = String(row['上次校验日'] ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
      ledger.push({
        id: nextLedgerId(ledger),
        装置编号: code,
        保护类型: String(row['保护类型'] ?? ''),
        记录时间: '',
        校验结论: '正常',
        动作次数: 0,
        校验人员: '',
        接收状态: '缺项说明',
        备注: MISSING_LEDGER_REMARK,
      })
      continue
    }
    ledger.push({
      id: nextLedgerId(ledger),
      装置编号: code,
      保护类型: String(row['保护类型'] ?? ''),
      记录时间: lastDate,
      校验结论: String(row.status) === '异常' ? '异常' : '正常',
      动作次数: Number.parseInt(String(row['动作次数'] ?? '0'), 10) || 0,
      校验人员: String(row['校验人员'] ?? ''),
      接收状态: '受理',
      备注: lastDate < '2026-09-01' ? STOCK_REMARK : '',
    })
  }
  ledger.sort((a, b) => (a.记录时间 < b.记录时间 ? -1 : a.记录时间 > b.记录时间 ? 1 : 0))
  doc.protectionLedger = ledger.map((item, index) => ({ ...item, id: index + 1 }))
  reconcileDevices(doc)
}

// 让设备台账与运行台账保持同步：结论与日期回填到设备行，汇总条也从同一批行统计。
export function reconcileDevices(doc: StoreDocument, todayValue?: string): void {
  const now = todayValue ?? new Date().toISOString().slice(0, 10)
  const rows = doc.entries.protection ?? []
  doc.entries.protection = rows.map((row) =>
    recomputeProtectionFlags({ ...row, status: deriveStatus(row, doc.protectionLedger) }, now),
  )
}

type SubmitInput = {
  id: number
  conclusion: Conclusion
  operator: string
  date: string
}

// 报送校验结论：同一装置、同一记录时间、同一结论只算一次，后到的一份直接退回、仅留痕，
// 不改设备、不进统计。受理的结论同步刷新设备状态与校验日期，汇总条随同一事务更新。
export function submitCalibration(input: SubmitInput): ActionResult {
  try {
    return mutate((doc) => {
      const rows = doc.entries.protection ?? []
      const row = rows.find((item) => Number(item.id) === input.id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${input.id} 的保护装置` }
      }
      if (String(row.status) === '已退出') {
        return { ok: false, message: `${row['装置编号']} 已退出运行，不再接收校验结论` }
      }
      const duplicate = doc.protectionLedger.some(
        (item) =>
          item.装置编号 === String(row['装置编号']) &&
          item.记录时间 === input.date &&
          item.校验结论 === input.conclusion,
      )
      if (duplicate) {
        doc.protectionLedger.push({
          id: nextLedgerId(doc.protectionLedger),
          装置编号: String(row['装置编号']),
          保护类型: String(row['保护类型'] ?? ''),
          记录时间: input.date,
          校验结论: input.conclusion,
          动作次数: Number.parseInt(String(row['动作次数'] ?? '0'), 10) || 0,
          校验人员: input.operator,
          接收状态: '退回',
          备注: '同装置、同记录时间、同结论重复报送，按首份为准，本份退回仅留痕',
        })
        return {
          ok: false,
          message: `${row['装置编号']} ${input.date}「${input.conclusion}」已报送过，重复报送已退回，仅作留痕`,
        }
      }
      const actionCount = Number.parseInt(String(row['动作次数'] ?? '0'), 10) || 0
      doc.protectionLedger.push({
        id: nextLedgerId(doc.protectionLedger),
        装置编号: String(row['装置编号']),
        保护类型: String(row['保护类型'] ?? ''),
        记录时间: input.date,
        校验结论: input.conclusion,
        动作次数: actionCount,
        校验人员: input.operator,
        接收状态: '受理',
        备注: '',
      })
      const index = rows.findIndex((item) => Number(item.id) === input.id)
      rows[index] = recomputeProtectionFlags(
        {
          ...rows[index],
          status: input.conclusion,
          上次校验日: input.date,
          下次校验日: shiftDate(input.date, CALIBRATION_CYCLE_DAYS),
          校验人员: input.operator,
        },
        input.date,
      )
      return {
        ok: true,
        message: `${row['装置编号']} 校验结论「${input.conclusion}」已受理并入运行台账，设备台账与汇总条已同步`,
      }
    })
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : '落库失败'}，本次报送已整套回滚，台账与设备均未改动`,
    }
  }
}

export function decommissionProtection(id: number): ActionResult {
  try {
    return mutate((doc) => {
      const rows = doc.entries.protection ?? []
      const row = rows.find((item) => Number(item.id) === id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的保护装置` }
      }
      if (String(row.status) === '已退出') {
        return { ok: false, message: `${row['装置编号']} 已退出运行` }
      }
      const index = rows.findIndex((item) => Number(item.id) === id)
      rows[index] = { ...rows[index], status: '已退出', pending: false, abnormal: false }
      return { ok: true, message: `${row['装置编号']} 已退出运行，在账台数相应核减` }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '落库失败，已整套回滚' }
  }
}

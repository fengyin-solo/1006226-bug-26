import { ledgerRecords } from '@/data/local-store'
import type { LedgerRecord } from '@/data/types'

// 运行台账：跨模块结论的唯一权威来源。所有「台数」类汇总都从这份流水出，
// 业务表上的状态字段仅作留痕比对；同一份结论重复报送只算一次。

export type BizEntry = {
  module: string
  bizType: string
  bizKey: string
  entityRef: string
  occurredAt: string
  recordedBy: string
  payload?: Record<string, string | number | boolean>
  backfilled?: boolean
  note?: string
  recordedAt?: string
}

export function findByBizKey(bizKey: string): LedgerRecord | undefined {
  return ledgerRecords().find((item) => item.bizKey === bizKey)
}

export function ledgerByModule(module: string): LedgerRecord[] {
  return ledgerRecords()
    .filter((item) => item.module === module && item.bizType !== 'legacy-gap-note')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

export function gapNotes(module: string): LedgerRecord[] {
  return ledgerRecords().filter((item) => item.module === module && item.bizType === 'legacy-gap-note')
}

/** 清污台账结论条数：跨模块读到的「已清污台/次数」以它为准。 */
export function cleaningLedgerCount(): number {
  return ledgerRecords().filter((item) => item.bizType === 'trashrack-cleaning').length
}

export function protectionCheckCount(): number {
  return ledgerRecords().filter((item) => item.bizType === 'protection-check').length
}

export type CaliberCompare = {
  /** 权威口径：运行台账记录数。 */
  ledger: number
  /** 留痕口径：业务表状态字段统计。 */
  trace: number
  /** 两套口径是否一致。 */
  consistent: boolean
}

/** 同一指标两套口径比对：台账为准，状态字段仅留痕。 */
export function compareCalibers(ledgerCount: number, traceCount: number): CaliberCompare {
  return { ledger: ledgerCount, trace: traceCount, consistent: ledgerCount === traceCount }
}

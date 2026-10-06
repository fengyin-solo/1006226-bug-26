import { cleaningRecords, getState, mutateState } from '@/data/local-store'
import { isBackfillDate, pressureAfterCleaning, pressureOf } from '@/domain/trashrack'
import { findByBizKey, type BizEntry } from '@/domain/ledger'
import type { ActionResult, CleaningRecord, EntryRow, LedgerRecord } from '@/data/types'

// 需要落到「栅体 + 清污记录 + 运行台账」三处的写操作统一走这里：同一事务提交、同一口径重算。

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function localTimestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function appendLedger(draft: { ledger: LedgerRecord[] }, entry: BizEntry): void {
  // 幂等：同一业务结论已经报送过，后到的一份直接退回（由调用方提前判定并返回失败）。
  draft.ledger.push({
    id: nextId(draft.ledger),
    module: entry.module,
    bizType: entry.bizType,
    bizKey: entry.bizKey,
    entityRef: entry.entityRef,
    occurredAt: entry.occurredAt,
    recordedAt: entry.recordedAt ?? localTimestamp(),
    recordedBy: entry.recordedBy,
    payload: entry.payload ?? {},
    backfilled: entry.backfilled ?? isBackfillDate(entry.occurredAt),
    note: entry.note,
  })
}

function reprojectRack(
  draft: { entries: Record<string, EntryRow[]>; cleaningRecords: CleaningRecord[] },
  rackId: number,
): void {
  const rows = draft.entries.trashrack ?? []
  const index = rows.findIndex((row) => Number(row.id) === rackId)
  if (index < 0) return
  const rack = rows[index]
  const rackRecords = draft.cleaningRecords
    .filter((item) => item.rackId === rackId)
    .sort((a, b) => a.cleanDate.localeCompare(b.cleanDate))
  const latest = rackRecords.at(-1)

  // 清污次数由记录数重算；清理日期/方式/人员投影最后一次记录，三处始终同一口径。
  rows[index] = {
    ...rack,
    清污次数: rackRecords.length,
    清理日期: latest?.cleanDate ?? rack['清理日期'],
    清污方式: latest?.method ?? rack['清污方式'],
    清理人员: latest?.operator ?? rack['清理人员'],
  }
}

export type ConfirmCleaningInput = {
  rackId: number
  cleanDate?: string
  method?: string
  operator?: string
}

/**
 * 确认完成清污：
 * 1. 只有「清理中」的栅体可以确认；已清理重复确认直接退回，不多计清污次数；
 * 2. 同一栅体同一清理日期的台账结论幂等，重复报送只算一次；
 * 3. 栅体状态、清污记录、运行台账同一事务提交，落盘失败整笔回滚；
 * 4. 提交后按同一口径重算前后压差（回到静态压差）、清污次数，并把栅体移出待清理名单。
 */
export function confirmCleaning(input: ConfirmCleaningInput): ActionResult {
  const cleanDate = (input.cleanDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { ok: false, message: '请选择有效的清理日期（YYYY-MM-DD）' }
  }
  const method = (input.method ?? '').trim() || '机械清污'
  const operator = (input.operator ?? '').trim() || '值班管理员'

  const state = getState()
  const rows = state.entries.trashrack ?? []
  const index = rows.findIndex((row) => Number(row.id) === input.rackId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.rackId} 的拦污栅` }
  }
  const rack = rows[index]
  const status = String(rack.status)
  if (status === '已清理') {
    return { ok: false, message: '该栅体已确认完成清污，重复确认不会多记清污次数' }
  }
  if (status === '已损坏') {
    return { ok: false, message: '栅体已登记损坏，不能确认清污，请先更换栅条' }
  }
  if (status !== '清理中') {
    return { ok: false, message: `栅体当前为「${status}」，请先安排清理再确认完成` }
  }

  const rackId = Number(rack.id)
  const bizKey = `trashrack-cleaning:${rackId}:${cleanDate}`
  if (findByBizKey(bizKey)) {
    return { ok: false, message: `${cleanDate} 的清污结论已报送过，重复报送直接退回，只计一次` }
  }
  // 同日重复报送（即便 bizKey 不同，也视为同一份数据重复上报）。
  const sameDay = state.cleaningRecords.some(
    (item) => item.rackId === rackId && item.cleanDate === cleanDate,
  )
  if (sameDay) {
    return { ok: false, message: '该栅体当日已有一条清污记录，同一数据重复报送只算一次' }
  }

  const pressureBefore = pressureOf(rack)
  const after = pressureAfterCleaning(rack)
  const recordedAt = localTimestamp()

  try {
    mutateState((draft) => {
      const draftRows = draft.entries.trashrack ?? []
      const draftIndex = draftRows.findIndex((row) => Number(row.id) === rackId)
      if (draftIndex < 0) throw new Error('栅体在事务中丢失')

      const record: CleaningRecord = {
        id: nextId(draft.cleaningRecords),
        rackId,
        rackCode: String(draftRows[draftIndex]['栅体编号']),
        unit: String(draftRows[draftIndex]['所属机组']),
        cleanDate,
        method,
        operator,
        pressureBefore,
        pressureAfter: after,
        recordedAt,
        backfilled: isBackfillDate(cleanDate),
        note: isBackfillDate(cleanDate) ? '补录上线前清污记录' : undefined,
      }
      draft.cleaningRecords.push(record)

      appendLedger(draft, {
        module: 'trashrack',
        bizType: 'trashrack-cleaning',
        bizKey,
        entityRef: record.rackCode,
        occurredAt: cleanDate,
        recordedAt,
        recordedBy: operator,
        payload: {
          rackId,
          pressureBefore,
          pressureAfter: after,
          method,
        },
        backfilled: record.backfilled,
        note: record.note,
      })

      // 栅体状态与压差在同一笔事务里重算：压差回到静态值、超限解除、移出待清理名单。
      draftRows[draftIndex] = {
        ...draftRows[draftIndex],
        status: '已清理',
        pending: false,
        abnormal: false,
        前后压差: after,
        栅体状态: '压差正常',
      }
      reprojectRack(draft, rackId)
    })
  } catch (error) {
    return {
      ok: false,
      message: `清污结论落库失败，已整笔回滚：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }

  return {
    ok: true,
    message: `清污完成：压差 ${pressureBefore.toFixed(1)}m → ${after.toFixed(1)}m，已移出待清理名单`,
  }
}

export type ProtectionCheckInput = {
  deviceId: number
  checkDate?: string
  checker?: string
  result?: string
}

/** 保护装置提交校验：装置状态与运行台账同一事务写入；重复校验报送直接退回。 */
export function submitProtectionCheck(input: ProtectionCheckInput): ActionResult {
  const checkDate = (input.checkDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
    return { ok: false, message: '请选择有效的校验日期（YYYY-MM-DD）' }
  }
  const checker = (input.checker ?? '').trim() || '值班管理员'
  const result = (input.result ?? '').trim() || '合格'

  const state = getState()
  const rows = state.entries.protection ?? []
  const index = rows.findIndex((row) => Number(row.id) === input.deviceId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.deviceId} 的保护装置` }
  }
  const device = rows[index]
  const deviceId = Number(device.id)
  const bizKey = `protection-check:${deviceId}:${checkDate}`
  if (findByBizKey(bizKey)) {
    return { ok: false, message: `${checkDate} 的校验结论已报送过，重复报送直接退回，只计一次` }
  }

  // 下次校验日按半年周期顺延。
  const [year, month, day] = checkDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1 + 6, day))
  const pad = (value: number) => String(value).padStart(2, '0')
  const nextDate = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
  const recordedAt = localTimestamp()

  try {
    mutateState((draft) => {
      const draftRows = draft.entries.protection ?? []
      const draftIndex = draftRows.findIndex((row) => Number(row.id) === deviceId)
      if (draftIndex < 0) throw new Error('装置在事务中丢失')

      appendLedger(draft, {
        module: 'protection',
        bizType: 'protection-check',
        bizKey,
        entityRef: String(draftRows[draftIndex]['装置编号']),
        occurredAt: checkDate,
        recordedAt,
        recordedBy: checker,
        payload: {
          checkResult: result,
          protectionType: String(draftRows[draftIndex]['保护类型']),
        },
        backfilled: isBackfillDate(checkDate),
        note: isBackfillDate(checkDate) ? '补录上线前校验记录' : undefined,
      })

      draftRows[draftIndex] = {
        ...draftRows[draftIndex],
        status: '正常',
        pending: false,
        abnormal: false,
        上次校验日: checkDate,
        下次校验日: nextDate,
        校验人员: checker,
        装置状态: result === '合格' ? '运行正常' : `校验${result}`,
      }
    })
  } catch (error) {
    return {
      ok: false,
      message: `校验结论落库失败，已整笔回滚：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }

  return { ok: true, message: `校验结论已入运行台账，装置状态已同步为「正常」` }
}

export { cleaningRecords }

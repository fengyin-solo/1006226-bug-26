import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, mutateState, resetRows } from '@/data/local-store'
import { confirmCleaning, submitProtectionCheck } from '@/domain/operations'
import { pendingRacks, summarizeTrashrack } from '@/domain/trashrack'
import type {
  ActionPayload,
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '登记损坏']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, payload: ActionPayload = {}): ActionResult {
  const meta = moduleMeta(key)

  // 拦污栅「确认完成」：状态、压差、次数、优先次序、台账在同一事务里按同一口径重算。
  if (key === 'trashrack' && action === '确认完成') {
    return confirmCleaning({
      rackId: id,
      cleanDate: payload.cleanDate,
      method: payload.method,
      operator: payload.operator,
    })
  }

  // 继电保护「提交校验」：装置状态与跨模块运行台账同事务写入。
  if (key === 'protection' && action === '提交校验') {
    return submitProtectionCheck({
      deviceId: id,
      checkDate: payload.checkDate,
      checker: payload.checker,
      result: payload.result,
    })
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  // 通用动作为单表单键写入，仍经事务通道提交，失败不留半截状态。
  commitRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function commitRows(key: string, rows: EntryRow[]): void {
  mutateState((draft) => {
    draft.entries[key] = rows
  })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

type ModuleOverview = { name: string; created: number; pending: number; abnormal: number }

function moduleOverview(key: string, name: string, entries: EntryRow[]): ModuleOverview {
  if (key === 'trashrack') {
    const summary = summarizeTrashrack(entries)
    return {
      name,
      created: entries.length,
      // 待处理与清污次序名单同一口径：待清理 + 清理中，已清理即时移出。
      pending: pendingRacks(entries).length,
      // 异常 = 压差超限 + 已损坏；确认清污、压差回落即解除。
      abnormal: summary.overLimitCount + summary.damagedCount,
    }
  }
  if (key === 'protection') {
    const dueSoon = entries.filter((row) => {
      if (String(row.status) !== '正常') return false
      const nextDate = String(row['下次校验日'] ?? '')
      return nextDate !== '' && nextDate <= '2026-10-06'
    }).length
    return {
      name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length + dueSoon,
    }
  }
  return {
    name,
    created: entries.length,
    pending: entries.filter((row) => row.pending).length,
    abnormal: entries.filter((row) => row.abnormal).length,
  }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) =>
    moduleOverview(meta.key, meta.name, rows[meta.key] ?? []),
  )
  const trashrackSummary = summarizeTrashrack(rows.trashrack ?? [])
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    // 拦污栅专项卡：与列表、清污次序同源，清污确认后立即回落。
    { label: '待清理栅体', value: trashrackSummary.pendingCount },
    { label: '压差超限栅体', value: trashrackSummary.overLimitCount },
  ]
  return { cards, modules }
}

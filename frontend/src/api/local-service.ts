import { today } from '@/data/clock'
import {
  MODULE_BY_KEY,
} from '@/data/modules'
import {
  allRows,
  armWriteFailure,
  getDocument,
  invalidateCache,
  listRows,
  mutate,
  resetRows,
} from '@/data/local-store'
import {
  cleaningQueue,
  confirmCleaning,
  markDamaged,
  scheduleCleaning,
  trashrackStats,
} from '@/domain/trashrack'
import {
  decommissionProtection,
  protectionStats,
  submitCalibration,
} from '@/domain/protection'
import type {
  ActionResult,
  CleaningLog,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ProtectionLedgerEntry,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退出']

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

// 拦污栅动作走业务域：确认完成时压差、优先次序、清污次数、清污清单在同一事务里落库。
function runTrashrackAction(action: string, id: number, operator: string): ActionResult {
  if (action === '确认完成') {
    return confirmCleaning(id, operator, today())
  }
  if (action === '安排清理') {
    return scheduleCleaning(id)
  }
  if (action === '登记损坏') {
    return markDamaged(id)
  }
  return { ok: false, message: `拦污栅没有登记「${action}」这个动作` }
}

// 继电保护动作走业务域：校验结论报送进运行台账，重复报送退回仅留痕。
function runProtectionAction(action: string, id: number, operator: string): ActionResult {
  if (action === '提交校验') {
    return submitCalibration({ id, conclusion: '正常', operator, date: today() })
  }
  if (action === '标记异常') {
    return submitCalibration({ id, conclusion: '异常', operator, date: today() })
  }
  if (action === '退出运行') {
    return decommissionProtection(id)
  }
  return { ok: false, message: `保护装置没有登记「${action}」这个动作` }
}

// 通用模块动作也走事务提交：落库失败整体回滚，不会只改半条状态。
function runGenericAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  try {
    return mutate((doc) => {
      const rows = doc.entries[key] ?? []
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
      }
      const current = String(rows[index].status)
      if (current === target) {
        return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
      }
      const lastStatus = meta.statuses[meta.statuses.length - 1]
      rows[index] = {
        ...rows[index],
        status: target,
        pending: target !== lastStatus,
        abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
      }
      return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
    })
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : '落库失败'}，本次操作已整套回滚`,
    }
  }
}

export function runAction(key: string, id: number, action: string, operator = '值班管理员'): ActionResult {
  if (key === 'trashrack') {
    return runTrashrackAction(action, id, operator)
  }
  if (key === 'protection') {
    return runProtectionAction(action, id, operator)
  }
  return runGenericAction(key, id, action)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return `﻿${[headers, ...rows].map((line) => line.map(escape).join(',')).join('\n')}`
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const rows = listRows(key).map((row) => [
    row.id,
    ...meta.fields.map((field) => String(row[field] ?? '')),
    row.status,
  ])
  return { filename: `${meta.name}-清单.csv`, content: toCsv(header, rows) }
}

export function downloadCsv(filename: string, content: string): void {
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

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadCsv(filename, content)
}

// ---- 拦污栅：清污次序与另存的清污清单，和栅体列表读同一份文档 ----

export function listCleaningQueue(): EntryRow[] {
  return cleaningQueue(listRows('trashrack'))
}

export function listCleaningLogs(): CleaningLog[] {
  // 另存的清污清单：按清理日期倒序，与列表、清污次序同源。
  return [...getDocument().cleaningLogs].sort((a, b) =>
    a.清理日期 < b.清理日期 ? 1 : a.清理日期 > b.清理日期 ? -1 : b.id - a.id,
  )
}

export function trashrackSummary() {
  return trashrackStats(listRows('trashrack'))
}

export function exportCleaningLogs(): { filename: string; content: string } {
  const header = ['序号', '栅体编号', '所属机组', '清理日期', '清污方式', '清理人员', '清前压差(m)', '清后压差(m)', '来源', '备注']
  const rows = listCleaningLogs().map((item) => [
    item.id,
    item.栅体编号,
    item.所属机组,
    item.清理日期 || '日期缺失',
    item.清污方式,
    item.清理人员,
    item.清前压差.toFixed(2),
    item.清后压差.toFixed(2),
    item.来源,
    item.备注,
  ])
  return { filename: '拦污栅-清污清单.csv', content: toCsv(header, rows) }
}

// ---- 继电保护：运行台账、汇总条与设备台账同源 ----

export function listProtectionLedger(): ProtectionLedgerEntry[] {
  // 最新结论在最上；退回/缺项说明保留可查，但不作为结论。
  return [...getDocument().protectionLedger].sort((a, b) =>
    a.记录时间 < b.记录时间 ? 1 : a.记录时间 > b.记录时间 ? -1 : b.id - a.id,
  )
}

export function protectionSummary() {
  return protectionStats(listRows('protection'), today())
}

export function exportProtectionLedger(): { filename: string; content: string } {
  const header = ['序号', '装置编号', '保护类型', '记录时间', '校验结论', '动作次数', '校验人员', '接收状态', '备注']
  const rows = listProtectionLedger().map((item) => [
    item.id,
    item.装置编号,
    item.保护类型,
    item.记录时间 || '时间缺失',
    item.接收状态 === '受理' ? item.校验结论 : `—（${item.接收状态}）`,
    item.动作次数,
    item.校验人员,
    item.接收状态,
    item.备注,
  ])
  return { filename: '继电保护-运行台账.csv', content: toCsv(header, rows) }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    let entries = rows[meta.key] ?? []
    if (meta.key === 'protection') {
      // 与继电保护页面、运行台账同一口径：到期随当天重算。
      entries = listRows('protection')
    }
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// 测试钩子随服务层一并转出，验证脚本只打一个包即可，避免多实例模块缓存不一致。
export { armWriteFailure, getDocument, invalidateCache }
export { setToday } from '@/data/clock'

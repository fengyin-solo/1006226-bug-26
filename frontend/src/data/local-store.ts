import { SEED_CLEANING } from './seed-cleaning'
import { SEED_LEDGER } from './seed-ledger'
import { SEED_ROWS } from './seed'
import type { AppState, CleaningRecord, EntryRow, LedgerRecord } from './types'

// 本地持久化：完整应用状态放在 localStorage 一个键里，事务整体写入，写入失败整笔回滚。
const STORAGE_KEY = 'hydropower-plant-om:app-state'
const STATE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function seedState(): AppState {
  return {
    version: STATE_VERSION,
    entries: clone(SEED_ROWS),
    cleaningRecords: clone(SEED_CLEANING),
    ledger: clone(SEED_LEDGER),
  }
}

function readStorage(): AppState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    commit(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppState>
    // 老版本（只有 entries）或被截断的脏数据：缺什么补什么，不允许带着半截状态运行。
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      throw new Error('应用状态结构不完整')
    }
    return {
      version: STATE_VERSION,
      entries: { ...clone(SEED_ROWS), ...parsed.entries },
      cleaningRecords: Array.isArray(parsed.cleaningRecords) ? parsed.cleaningRecords : clone(SEED_CLEANING),
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : clone(SEED_LEDGER),
    }
  } catch {
    commit(fallback)
    return fallback
  }
}

let cache: AppState | null = null

export function getState(): AppState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return getState().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function cleaningRecords(): CleaningRecord[] {
  return getState().cleaningRecords
}

export function ledgerRecords(): LedgerRecord[] {
  return getState().ledger
}

function commit(state: AppState): void {
  const serialized = JSON.stringify(state)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 单次 setItem：要么整笔落盘，要么抛错不动旧值，杜绝只写进去半条记录。
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = state
}

/**
 * 在草稿上做一组改动，全部成功才整体提交；任一步抛错，草稿丢弃，内存与磁盘都保持上一次提交的状态。
 * mutate 不允许自己碰缓存，只能改传入的草稿。
 */
export function mutateState(mutate: (draft: AppState) => void): void {
  const draft = clone(getState())
  mutate(draft)
  commit(draft)
}

/** 重置单个业务模块（连同由它产生的台账结论一起回到种子，避免台数对不上）。 */
export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  mutateState((draft) => {
    draft.entries[key] = rows
    if (key === 'trashrack') {
      draft.cleaningRecords = clone(SEED_CLEANING)
      // 拦污栅台账（清污结论 + 缺项说明）整组重建，其余模块的台账原样保留。
      draft.ledger = [
        ...clone(SEED_LEDGER).filter((item) => item.module === 'trashrack'),
        ...draft.ledger.filter((item) => item.module !== 'trashrack'),
      ]
    }
    if (key === 'protection') {
      draft.ledger = [
        ...clone(SEED_LEDGER).filter((item) => item.module === 'protection'),
        ...draft.ledger.filter((item) => item.module !== 'protection'),
      ]
    }
  })
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 仅供测试：丢弃内存缓存，下次读取重新走存储。 */
export function __resetCacheForTest(): void {
  cache = null
}

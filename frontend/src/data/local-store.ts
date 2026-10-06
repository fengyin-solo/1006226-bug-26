import { today } from './clock'
import { bootstrapProtection, recomputeProtectionFlags } from '@/domain/protection'
import { bootstrapTrashrack, recomputeFlags as recomputeTrashrackFlags } from '@/domain/trashrack'
import { SEED_DOCUMENT } from './seed'
import type { EntryRow, StoreDocument } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 栅体清单/清污日志、保护装置/运行台账同处一份文档，动作流转统一走 mutate 事务提交：
// 落库失败时整套回滚，绝不允许只写进去半条记录。
const STORAGE_KEY = 'hydropower-plant-om:entries'
const DOCUMENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isDocument(value: unknown): value is StoreDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    typeof (value as StoreDocument).entries === 'object'
  )
}

// 兼容 v1：旧版只存了 entries，没有清污日志与保护台账。
// 合并旧 entries 后，清污日志与运行台账按旧行重新回填，保证日志和实际栅体/装置对得上。
function migrate(raw: unknown): StoreDocument {
  if (isDocument(raw) && raw.version >= DOCUMENT_VERSION) {
    return {
      ...clone(SEED_DOCUMENT),
      ...clone(raw),
      entries: { ...clone(SEED_DOCUMENT).entries, ...clone(raw.entries) },
    }
  }
  const legacyEntries =
    typeof raw === 'object' && raw !== null && !('entries' in raw)
      ? (raw as Record<string, never>)
      : isDocument(raw)
        ? raw.entries
        : {}
  const seeded = clone(SEED_DOCUMENT)
  const doc: StoreDocument = {
    ...seeded,
    entries: { ...seeded.entries, ...clone(legacyEntries) },
    cleaningLogs: [],
    protectionLedger: [],
  }
  bootstrapTrashrack(doc)
  bootstrapProtection(doc)
  // 旧行没有经过业务域，拦污栅的待处理/超限标记按统一口径重算一遍。
  doc.entries.trashrack = (doc.entries.trashrack ?? []).map((row) =>
    recomputeTrashrackFlags(row),
  )
  return doc
}

function readStorage(): StoreDocument {
  const fallback = clone(SEED_DOCUMENT)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    write(fallback)
    return fallback
  }
  try {
    return migrate(JSON.parse(raw))
  } catch {
    write(fallback)
    return fallback
  }
}

let cache: StoreDocument | null = null

// 测试钩子：置为 true 后下一次落库必定抛错，验证事务回滚后自动复位。
// 挂在 globalThis 上，保证应用代码与测试脚本即使是不同打包实例也能触发同一个开关。
declare global {
  // eslint-disable-next-line no-var
  var __FAIL_NEXT_WRITE__: boolean | undefined
}

export function armWriteFailure(): void {
  globalThis.__FAIL_NEXT_WRITE__ = true
}

function write(doc: StoreDocument): void {
  if (globalThis.__FAIL_NEXT_WRITE__) {
    globalThis.__FAIL_NEXT_WRITE__ = false
    throw new Error('模拟落库失败：本次写入被拒绝')
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
  }
}

export function getDocument(): StoreDocument {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/**
 * 事务提交：在同一份草稿上改，落库成功才替换缓存；落库失败缓存与已存数据都保持原样，
 * 不会留下「栅体状态改了、压差和次序没重算」的半条记录。
 */
export function mutate<T>(fn: (doc: StoreDocument) => T): T {
  const snapshot = cache
  const persisted =
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(STORAGE_KEY)
      : null
  const draft = clone(getDocument())
  const outcome = fn(draft)
  try {
    write(draft)
  } catch (error) {
    // 回滚：内存缓存恢复到提交前，存储也回写提交前的内容，清掉任何半截痕迹。
    cache = snapshot
    if (typeof window !== 'undefined' && window.localStorage && persisted !== null) {
      try {
        window.localStorage.setItem(STORAGE_KEY, persisted)
      } catch {
        // 存储本身不可用时保持内存回滚即可，不能让回写失败盖住原始的落库错误。
      }
    }
    throw error
  }
  cache = draft
  return outcome
}

export function replaceDocument(doc: StoreDocument): void {
  cache = clone(doc)
  write(cache)
}

export function invalidateCache(): void {
  cache = null
}

export function allRows(): Record<string, EntryRow[]> {
  return getDocument().entries
}

export function listRows(key: string): EntryRow[] {
  const rows = getDocument().entries[key] ?? []
  if (key === 'protection') {
    // 「即将到期/待校验」随当前日期变化，读取时按统一口径归一化，概览与台账永远同口径。
    const now = today()
    return rows.map((row) => recomputeProtectionFlags(row, now))
  }
  return rows
}

export function saveRows(key: string, rows: EntryRow[]): void {
  mutate((doc) => {
    doc.entries[key] = rows
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_DOCUMENT.entries[key] ?? [])
  mutate((doc) => {
    doc.entries[key] = rows
    if (key === 'trashrack') {
      doc.cleaningLogs = clone(SEED_DOCUMENT.cleaningLogs)
    }
    if (key === 'protection') {
      doc.protectionLedger = clone(SEED_DOCUMENT.protectionLedger)
    }
  })
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

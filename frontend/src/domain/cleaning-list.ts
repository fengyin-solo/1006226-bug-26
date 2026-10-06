import { listRows } from '@/data/local-store'
import { cleaningQueue, pressureOf } from '@/domain/trashrack'
import type { EntryRow } from '@/data/types'

// 「另存清污清单」：另存的只是当时名单的栅体编号与压差快照（留痕），
// 重新打开时仍回到同一份业务数据重取，台数与压差以同源数据为准，不会另存出第二套口径。

const SNAPSHOT_KEY = 'hydropower-plant-om:saved-cleaning-list'

export type SavedQueueItem = {
  rackCode: string
  unit: string
  pressure: number
  rank: number
}

export type SavedCleaningSnapshot = {
  savedAt: string
  items: SavedQueueItem[]
}

export function queueSnapshot(): SavedQueueItem[] {
  return cleaningQueue(listRows('trashrack')).map((row, index) => ({
    rackCode: String(row['栅体编号']),
    unit: String(row['所属机组']),
    pressure: pressureOf(row),
    rank: index + 1,
  }))
}

export function saveCleaningList(): SavedCleaningSnapshot {
  const snapshot: SavedCleaningSnapshot = { savedAt: new Date().toISOString(), items: queueSnapshot() }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  }
  return snapshot
}

export function loadSavedCleaningList(): SavedCleaningSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(SNAPSHOT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SavedCleaningSnapshot
  } catch {
    return null
  }
}

export function clearSavedCleaningList(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(SNAPSHOT_KEY)
  }
}

/**
 * 快照与当前同源名单比对：已清理的栅体会不在当前名单里（待清理台数跟着减少），
 * 压差重算后优先次序也会变化。返回的列表始终读当前数据，快照只负责标出差异。
 */
export type SnapshotDiff = {
  code: string
  unit: string
  savedRank: number
  savedPressure: number
  currentRank: number | null
  currentPressure: number | null
  removed: boolean
}

export function diffSnapshot(snapshot: SavedCleaningSnapshot): SnapshotDiff[] {
  const current: EntryRow[] = cleaningQueue(listRows('trashrack'))
  return snapshot.items.map((item) => {
    const liveIndex = current.findIndex((row) => String(row['栅体编号']) === item.rackCode)
    const live = liveIndex >= 0 ? current[liveIndex] : undefined
    return {
      code: item.rackCode,
      unit: item.unit,
      savedRank: item.rank,
      savedPressure: item.pressure,
      currentRank: live ? liveIndex + 1 : null,
      currentPressure: live ? pressureOf(live) : null,
      removed: !live,
    }
  })
}

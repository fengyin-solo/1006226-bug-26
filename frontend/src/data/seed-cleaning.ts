import type { CleaningRecord } from './types'

// 平台上线日：早于这一天的清污均为存量台账按实际清理日期补录。
export const GO_LIVE_DATE = '2026-09-01'

// 存量清污记录：栅体上的「清污次数」「清理日期」由这份记录重算，不允许手工各写各的。
// 上线前的几次清污纸质台账齐全，按清理日期原样补录；字段缺失的不推算，另立缺项说明。
export const SEED_CLEANING: CleaningRecord[] = [
  // —— TRAS-0001：上线前 2 次 + 上线后 1 次 ——
  {
    id: 1,
    rackId: 1,
    rackCode: 'TRAS-0001',
    unit: '1号机组',
    cleanDate: '2026-05-12',
    method: '机械清污',
    operator: '陈志强',
    pressureBefore: 3.1,
    pressureAfter: 0.7,
    recordedAt: '2026-09-01T08:30:00+08:00',
    backfilled: true,
    note: '上线前纸质台账补录',
  },
  {
    id: 2,
    rackId: 1,
    rackCode: 'TRAS-0001',
    unit: '1号机组',
    cleanDate: '2026-07-18',
    method: '人工清污',
    operator: '李建国',
    pressureBefore: 2.9,
    pressureAfter: 0.8,
    recordedAt: '2026-09-01T08:30:00+08:00',
    backfilled: true,
    note: '上线前纸质台账补录',
  },
  {
    id: 3,
    rackId: 1,
    rackCode: 'TRAS-0001',
    unit: '1号机组',
    cleanDate: '2026-09-22',
    method: '机械清污',
    operator: '李建国',
    pressureBefore: 3.4,
    pressureAfter: 0.7,
    recordedAt: '2026-09-22T15:10:00+08:00',
    backfilled: false,
  },

  // —— TRAS-0002：上线前 1 次 + 上线后 1 次 ——
  {
    id: 4,
    rackId: 2,
    rackCode: 'TRAS-0002',
    unit: '2号机组',
    cleanDate: '2026-06-08',
    method: '机械清污',
    operator: '赵晓东',
    pressureBefore: 3.0,
    pressureAfter: 0.6,
    recordedAt: '2026-09-01T08:30:00+08:00',
    backfilled: true,
    note: '上线前纸质台账补录',
  },
  {
    id: 5,
    rackId: 2,
    rackCode: 'TRAS-0002',
    unit: '2号机组',
    cleanDate: '2026-09-24',
    method: '人工清污',
    operator: '王海涛',
    pressureBefore: 3.3,
    pressureAfter: 0.6,
    recordedAt: '2026-09-24T10:40:00+08:00',
    backfilled: false,
  },

  // —— TRAS-0003：上线后 2 次 ——
  {
    id: 6,
    rackId: 3,
    rackCode: 'TRAS-0003',
    unit: '2号机组',
    cleanDate: '2026-09-15',
    method: '机械清污',
    operator: '赵晓东',
    pressureBefore: 2.8,
    pressureAfter: 0.8,
    recordedAt: '2026-09-15T14:05:00+08:00',
    backfilled: false,
  },
  {
    id: 7,
    rackId: 3,
    rackCode: 'TRAS-0003',
    unit: '2号机组',
    cleanDate: '2026-10-04',
    method: '机械清污',
    operator: '赵晓东',
    pressureBefore: 3.0,
    pressureAfter: 0.8,
    recordedAt: '2026-10-04T09:20:00+08:00',
    backfilled: false,
  },

  // —— TRAS-0004：上线后 1 次 ——
  {
    id: 8,
    rackId: 4,
    rackCode: 'TRAS-0004',
    unit: '3号机组',
    cleanDate: '2026-09-30',
    method: '机械清污',
    operator: '李建国',
    pressureBefore: 2.6,
    pressureAfter: 0.7,
    recordedAt: '2026-09-30T11:25:00+08:00',
    backfilled: false,
  },

  // —— TRAS-0005：上线后 1 次 ——
  {
    id: 9,
    rackId: 5,
    rackCode: 'TRAS-0005',
    unit: '1号机组',
    cleanDate: '2026-09-26',
    method: '人工清污',
    operator: '王海涛',
    pressureBefore: 2.9,
    pressureAfter: 0.6,
    recordedAt: '2026-09-26T16:45:00+08:00',
    backfilled: false,
  },

  // —— TRAS-0006：上线前 1 次（损坏栅体）——
  {
    id: 10,
    rackId: 6,
    rackCode: 'TRAS-0006',
    unit: '3号机组',
    cleanDate: '2026-08-28',
    method: '机械清污',
    operator: '陈志强',
    pressureBefore: 2.7,
    pressureAfter: 0.5,
    recordedAt: '2026-09-01T08:30:00+08:00',
    backfilled: true,
    note: '上线前纸质台账补录；该栅体于2026-09-12检查发现栅条变形',
  },
]

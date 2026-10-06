import { SEED_CLEANING } from './seed-cleaning'
import type { LedgerRecord } from './types'

// 运行台账：跨模块结论的唯一权威口径。
// 清污结论由清污记录逐条投影，保护校验结论按业务日期补录；早年纸质缺项立「缺项说明」条目，不做推算。
function buildSeedLedger(): LedgerRecord[] {
  const ledger: LedgerRecord[] = []
  let seq = 0

  for (const item of SEED_CLEANING) {
    seq += 1
    ledger.push({
      id: seq,
      module: 'trashrack',
      bizType: 'trashrack-cleaning',
      bizKey: `trashrack-cleaning:${item.rackId}:${item.cleanDate}`,
      entityRef: item.rackCode,
      occurredAt: item.cleanDate,
      recordedAt: item.recordedAt,
      recordedBy: item.operator,
      payload: {
        rackId: item.rackId,
        pressureBefore: item.pressureBefore,
        pressureAfter: item.pressureAfter,
        method: item.method,
      },
      backfilled: item.backfilled,
      note: item.note,
    })
  }

  // 保护装置定期校验台账：上线前的校验按校验日期补录。
  const protectionChecks: Array<Omit<LedgerRecord, 'id' | 'module' | 'bizType'>> = [
    {
      bizKey: 'protection-check:1:2026-03-20',
      entityRef: 'PROT-0001',
      occurredAt: '2026-03-20',
      recordedAt: '2026-09-01T08:30:00+08:00',
      recordedBy: '周文斌',
      payload: { checkResult: '合格', protectionType: '发电机差动保护' },
      backfilled: true,
      note: '上线前纸质校验单补录',
    },
    {
      bizKey: 'protection-check:1:2026-09-18',
      entityRef: 'PROT-0001',
      occurredAt: '2026-09-18',
      recordedAt: '2026-09-18T11:00:00+08:00',
      recordedBy: '周文斌',
      payload: { checkResult: '合格', protectionType: '发电机差动保护' },
      backfilled: false,
    },
    {
      bizKey: 'protection-check:2:2026-03-10',
      entityRef: 'PROT-0002',
      occurredAt: '2026-03-10',
      recordedAt: '2026-09-01T08:30:00+08:00',
      recordedBy: '周文斌',
      payload: { checkResult: '合格', protectionType: '主变瓦斯保护' },
      backfilled: true,
      note: '上线前纸质校验单补录',
    },
    {
      bizKey: 'protection-check:3:2026-03-22',
      entityRef: 'PROT-0003',
      occurredAt: '2026-03-22',
      recordedAt: '2026-09-01T08:30:00+08:00',
      recordedBy: '孙立军',
      payload: { checkResult: '合格', protectionType: '线路距离保护' },
      backfilled: true,
      note: '上线前纸质校验单补录',
    },
    {
      bizKey: 'protection-check:3:2026-09-25',
      entityRef: 'PROT-0003',
      occurredAt: '2026-09-25',
      recordedAt: '2026-09-25T10:30:00+08:00',
      recordedBy: '孙立军',
      payload: { checkResult: '合格', protectionType: '线路距离保护' },
      backfilled: false,
    },
  ]
  for (const item of protectionChecks) {
    seq += 1
    ledger.push({ id: seq, module: 'protection', bizType: 'protection-check', ...item })
  }

  // 早年缺项：纸质台账不完整的部分不推算、不补造记录，单独立说明留痕。
  const gapNotes: Array<Omit<LedgerRecord, 'id' | 'bizType' | 'bizKey'>> = [
    {
      module: 'trashrack',
      entityRef: '全站拦污栅',
      occurredAt: '2024-06-30',
      recordedAt: '2026-09-01T08:30:00+08:00',
      recordedBy: '值班管理员',
      payload: { scope: '2024年及以前' },
      backfilled: true,
      note: '2024年及以前清污仅保留纸质登记，部分栅体清理日期、清理前后压差缺项，无法按记录时间完整回填；该时段不推算补造清污记录，以纸质台账为唯一依据。',
    },
    {
      module: 'protection',
      entityRef: '全站保护装置',
      occurredAt: '2024-12-31',
      recordedAt: '2026-09-01T08:30:00+08:00',
      recordedBy: '值班管理员',
      payload: { scope: '2024年及以前' },
      backfilled: true,
      note: '2024年及以前保护定检单部分归档不全，校验结论缺项，不做推算；该时段校验结论以继保室纸质定检报告为唯一依据。',
    },
  ]
  for (const item of gapNotes) {
    seq += 1
    ledger.push({
      id: seq,
      bizType: 'legacy-gap-note',
      bizKey: `legacy-gap-note:${item.module}:${item.occurredAt}`,
      ...item,
    })
  }

  return ledger
}

export const SEED_LEDGER: LedgerRecord[] = buildSeedLedger()

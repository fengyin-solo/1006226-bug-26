/**
 * 领域逻辑验证脚本（纯 Node，不依赖浏览器）：
 *   npx esbuild scripts/verify-domain.ts --bundle --platform=node --format=cjs | node
 * 用内存版 localStorage 模拟落盘，并在指定步骤注入写入失败，验证整笔回滚。
 */

// ---- 内存 localStorage（可注入故障）----
class MemoryStorage {
  private map = new Map<string, string>()
  failOnSet = false
  setItem(key: string, value: string) {
    if (this.failOnSet) throw new Error('模拟落盘失败')
    this.map.set(key, value)
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}
const storage = new MemoryStorage()
;(globalThis as unknown as { window: unknown }).window = { localStorage: storage }
;(globalThis as unknown as { localStorage: Storage }).localStorage =
  storage as unknown as Storage

import { getState, __resetCacheForTest } from '../src/data/local-store'
import {
  cleaningQueue,
  compareRackCalibers,
  isOverLimit,
  pressureOf,
  summarizeTrashrack,
} from '../src/domain/trashrack'
import { cleaningLedgerCount } from '../src/domain/ledger'
import { confirmCleaning, submitProtectionCheck } from '../src/domain/operations'
import { runAction, loadOverview } from '../src/api/local-service'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  =>  ${JSON.stringify(actual)}${pass ? '' : `（期望 ${JSON.stringify(expected)}）`}`)
  if (!pass) failures += 1
}

function rack(id: number) {
  return getState().entries.trashrack.find((row) => Number(row.id) === id)!
}

// ---------- 初始态 ----------
const initial = summarizeTrashrack()
check('初始：待清理台数（含清理中）', initial.pendingCount, 3)
check('初始：压差超限台数', initial.overLimitCount, 3)
check('初始：已清理台数', initial.cleanedCount, 2)
check('初始：最大压差', Number(initial.maxPressure.toFixed(1)), 3.6)

const queue0 = cleaningQueue().map((row) => String(row['栅体编号']))
check('初始：清污次序按压差降序', queue0, ['TRAS-0001', 'TRAS-0002', 'TRAS-0005'])

// 概览与领域同口径
const overview = loadOverview()
const trashOverview = overview.modules.find((item) => item.name === '拦污栅')!
check('概览：拦污栅待处理=队列长度', trashOverview.pending, 3)
check('概览：拦污栅异常=超限+损坏', trashOverview.abnormal, 4)

// ---------- 待清理栅体不能直接确认完成 ----------
const r1 = confirmCleaning({ rackId: 1, cleanDate: '2026-10-06', method: '机械清污', operator: '测试员' })
check('待清理状态直接确认被拒绝', r1.ok, false)
check('被拒后压差未被改动', pressureOf(rack(1)), 3.6)
check('被拒后清污次数未变', rack(1)['清污次数'], 3)

// ---------- 已清理重复确认不多计 ----------
const r3 = confirmCleaning({ rackId: 3, cleanDate: '2026-10-05' })
check('已清理重复确认被退回', r3.ok, false)
check('重复确认后清污次数不变', rack(3)['清污次数'], 2)

// ---------- 清理中 → 确认完成：三处同事务重算 ----------
const before2 = {
  status: rack(2).status,
  pressure: pressureOf(rack(2)),
  count: Number(rack(2)['清污次数']),
  ledgerTotal: cleaningLedgerCount(),
}
const ok2 = confirmCleaning({ rackId: 2, cleanDate: '2026-10-06', method: '人工清污', operator: '郑工' })
check('清理中确认完成成功', ok2.ok, true)
check('确认后状态=已清理', rack(2).status, '已清理')
check('确认后压差回到静态值', pressureOf(rack(2)), 0.6)
check('确认后超限解除', isOverLimit(rack(2)), false)
check('确认后清污次数+1', Number(rack(2)['清污次数']), before2.count + 1)
check('确认后栅体清理人员投影', rack(2)['清理人员'], '郑工')
check('确认后栅体清理日期投影', rack(2)['清理日期'], '2026-10-06')
check('台账结论同步+1', cleaningLedgerCount(), before2.ledgerTotal + 1)

const queue1 = cleaningQueue().map((row) => String(row['栅体编号']))
check('确认后从待清理名单移出且次序重排', queue1, ['TRAS-0001', 'TRAS-0005'])
check('确认后待清理台数减少', summarizeTrashrack().pendingCount, 2)

// 概览同步
const overview2 = loadOverview()
const trashOverview2 = overview2.modules.find((item) => item.name === '拦污栅')!
check('概览待处理同步减少', trashOverview2.pending, 2)
check('概览异常同步减少（剩 2 超限+1 损坏）', trashOverview2.abnormal, 3)

// 重复确认同一栅体（现在已清理）
const dup = confirmCleaning({ rackId: 2, cleanDate: '2026-10-07' })
check('确认后再次确认被退回', dup.ok, false)
check('再次确认次数不增加', Number(rack(2)['清污次数']), before2.count + 1)

// ---------- 同一份数据重复报送只算一次（同一栅体同一天）----------
// 先安排 1 号进入清理中（已经是待清理，执行通用动作）
runAction('trashrack', 1, '安排清理')
const dupDate = confirmCleaning({ rackId: 1, cleanDate: '2026-10-06', method: '机械清污', operator: '郑工' })
check('同日首次报送成功', dupDate.ok, true)
// 模拟同一数据重发：此时栅体已清理，直接被状态拦截
const resend = confirmCleaning({ rackId: 1, cleanDate: '2026-10-06' })
check('同一数据后到一份直接退回', resend.ok, false)
check('退回后次数仍只算一次', Number(rack(1)['清污次数']), 4)

// ---------- 两套口径一致（台账权威 vs 状态留痕）----------
const calibers = compareRackCalibers()
check('清污口径：台账条数=栅体次数合计', calibers.consistent, true)

// ---------- 跨模块：保护页读到的清污台数 = 清污记录数 ----------
const cleaningRecordsCount = getState().cleaningRecords.length
check('跨模块清污台数一致', cleaningLedgerCount(), cleaningRecordsCount)

// ---------- 保护校验：入账 + 幂等 ----------
const ledgerBefore = getState().ledger.length
const checkOk = submitProtectionCheck({ deviceId: 2, checkDate: '2026-10-06', checker: '周工', result: '合格' })
check('保护校验提交成功', checkOk.ok, true)
const device2 = getState().entries.protection.find((row) => Number(row.id) === 2)!
check('装置状态同步为正常', device2.status, '正常')
check('待校验标记解除', device2.pending, false)
check('下次校验日顺延半年', device2['下次校验日'], '2027-04-06')
check('校验台账+1', getState().ledger.length, ledgerBefore + 1)
const checkDup = submitProtectionCheck({ deviceId: 2, checkDate: '2026-10-06', checker: '周工' })
check('同一校验重复报送退回', checkDup.ok, false)
check('退回后台账条数不变', getState().ledger.length, ledgerBefore + 1)

// ---------- 上线前补录 ----------
const backfill = confirmCleaning({
  rackId: 5,
  cleanDate: '2026-08-15',
  method: '人工清污',
  operator: '陈师傅',
})
// 5 号当前是「待清理」，需先安排
check('未安排先补录被拒绝', backfill.ok, false)
runAction('trashrack', 5, '安排清理')
const backfill2 = confirmCleaning({
  rackId: 5,
  cleanDate: '2026-08-15',
  method: '人工清污',
  operator: '陈师傅',
})
check('上线前清污按业务日期补录成功', backfill2.ok, true)
const backfilledRecord = getState().cleaningRecords.find(
  (item) => item.rackId === 5 && item.cleanDate === '2026-08-15',
)!
check('补录记录标记 backfilled', backfilledRecord.backfilled, true)
const backfilledLedger = getState().ledger.find(
  (item) => item.bizKey === 'trashrack-cleaning:5:2026-08-15',
)!
check('补录台账 occurredAt 按清理日期', backfilledLedger.occurredAt, '2026-08-15')

// ---------- 落库失败整笔回滚 ----------
// 清空存储与内存缓存，让数据回到种子态（2 号为「清理中」），随后让下一次写入必然失败。
storage.removeItem('hydropower-plant-om:app-state')
__resetCacheForTest()
check('回滚场景前置：2号为清理中', rack(2).status, '清理中')
const recordsBeforeFail = getState().cleaningRecords.length
storage.failOnSet = true
const failResult = confirmCleaning({ rackId: 2, cleanDate: '2026-10-06', method: '人工清污', operator: '郑工' })
storage.failOnSet = false
check('落库失败返回回滚提示', failResult.ok, false)
check('失败提示包含回滚', failResult.message.includes('回滚'), true)
check('失败后栅体状态保持清理中（无半截状态）', rack(2).status, '清理中')
check('失败后压差仍是清理前大数', pressureOf(rack(2)), 3.2)
check('失败后清污次数未增加', Number(rack(2)['清污次数']), 2)
check('失败后清污记录未写入半条', getState().cleaningRecords.length, recordsBeforeFail)

// ---------- 最终口径总检 ----------
const finalCalibers = compareRackCalibers()
check('最终：台账与栅体口径一致', finalCalibers.consistent, true)
check('最终：跨模块台数一致', cleaningLedgerCount(), getState().cleaningRecords.length)

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)

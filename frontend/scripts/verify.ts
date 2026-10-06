// 业务验证脚本：用内存 localStorage 在 node 里跑同一套数据层与业务域，
// 覆盖：统一重算、幂等、重复报送退回、存量回填、落库失败整套回滚、跨模块台数一致。
// 运行：node scripts/verify.mjs（由 Makefile verify 目标用 esbuild 打包后执行）。

/* eslint-disable no-console */
function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (globalThis.__FAIL_NEXT_WRITE__) {
        globalThis.__FAIL_NEXT_WRITE__ = false
        throw new Error('QuotaExceededError')
      }
      map.set(key, String(value))
    },
    removeItem: (key) => map.delete(key),
    __dump: () => (map.has('hydropower-plant-om:entries') ? JSON.parse(map.get('hydropower-plant-om:entries')) : null),
  }
}

globalThis.window = { localStorage: createMemoryStorage() }

const {
  armWriteFailure,
  getDocument,
  invalidateCache,
  listCleaningLogs,
  listCleaningQueue,
  listEntries,
  listProtectionLedger,
  loadOverview,
  protectionSummary,
  runAction,
  setToday,
  trashrackSummary,
} = await import('./bundle.js')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

setToday('2026-10-06')

console.log('\n[1] 播种：压差与待处理标记同口径')
const rows = listEntries('trashrack').items
const byCode = Object.fromEntries(rows.map((r) => [r['栅体编号'], r]))
check('TRAS-0001 压差 2.35 超限且待处理', byCode['TRAS-0001'].abnormal === true && byCode['TRAS-0001'].pending === true)
check('TRAS-0004 已清理压差 0.10 不超限不待处理', byCode['TRAS-0004'].abnormal === false && byCode['TRAS-0004'].pending === false)

console.log('\n[2] 清污次序：按当前压差降序')
const queue = listCleaningQueue().map((r) => r['栅体编号'])
check('队列首位为压差最大的 TRAS-0001(2.35)', queue[0] === 'TRAS-0001', queue.join(','))
check('已清理与已损坏不在队列', !queue.includes('TRAS-0004') && !queue.includes('TRAS-0006'))
const beforePending = trashrackSummary().pending
check(`初始待清理台数为 ${beforePending}（4 台）`, beforePending === 4)

console.log('\n[3] 确认完成：状态/压差/次数/次序/清单同一事务更新')
const confirm1 = runAction('trashrack', byCode['TRAS-0001'].id, '确认完成', '测试员')
check('确认返回成功', confirm1.ok, confirm1.message)
const r1 = listEntries('trashrack').items.find((r) => r['栅体编号'] === 'TRAS-0001')
check('状态变为已清理', r1.status === '已清理')
check('前后压差重算为 0.10m', Number(r1['前后压差']) === 0.1, String(r1['前后压差']))
check('不再超限', r1.abnormal === false)
check('清污次数 3 → 4', Number(r1['清污次数']) === 4, String(r1['清污次数']))
check('清理日期回填为今天 2026-10-06', r1['清理日期'] === '2026-10-06')
const queueAfter = listCleaningQueue().map((r) => r['栅体编号'])
check('已移出待清理队列', !queueAfter.includes('TRAS-0001'))
check('新队列首位为 TRAS-0002(1.82)', queueAfter[0] === 'TRAS-0002', queueAfter.join(','))
check('待清理台数减少一台', trashrackSummary().pending === beforePending - 1)
const logs = listCleaningLogs()
const newLog = logs.find((l) => l.栅体编号 === 'TRAS-0001' && l.清理日期 === '2026-10-06')
check('另存清污清单新增一条，清前 2.35 / 清后 0.10', !!newLog && newLog.清前压差 === 2.35 && newLog.清后压差 === 0.1)
check('新清单记录来源为运行登记', newLog?.来源 === '运行登记')

console.log('\n[4] 幂等：同一栅体重复确认不多算')
const confirm2 = runAction('trashrack', r1.id, '确认完成', '测试员')
check('重复确认被拒绝', !confirm2.ok, confirm2.message)
const r1b = listEntries('trashrack').items.find((r) => r['栅体编号'] === 'TRAS-0001')
check('清污次数仍为 4', Number(r1b['清污次数']) === 4)
check('清污清单没有多写（今天仍只有 1 条该栅记录）', logs.filter((l) => l.栅体编号 === 'TRAS-0001' && l.清理日期 === '2026-10-06').length === 1
  && listCleaningLogs().filter((l) => l.栅体编号 === 'TRAS-0001' && l.清理日期 === '2026-10-06').length === 1)

console.log('\n[5] 概览与列表同口径（压差超限不再挂着）')
const overviewTr = loadOverview().modules.find((m) => m.name === '拦污栅')
const summary = trashrackSummary()
check('概览待处理 = 栅体域统计待处理', overviewTr.pending === summary.pending, `${overviewTr.pending} vs ${summary.pending}`)
check('概览异常量 = 超限台数 + 损坏台数', overviewTr.abnormal === summary.overLimitCount + summary.damaged,
  `${overviewTr.abnormal} vs ${summary.overLimitCount + summary.damaged}`)

console.log('\n[6] 历史清污按清理日期回填；早于上线的标存量补录；缺日期不虚构')
const stock0001 = logs.filter((l) => l.栅体编号 === 'TRAS-0001')
check('TRAS-0001 历史 3 次清污均已回填（含今天确认共 4 条）', stock0001.length === 4, String(stock0001.length))
check('2026-08-20 的清污标记为存量补录', stock0001.some((l) => l.清理日期 === '2026-08-20' && l.来源 === '存量补录'))
check('回填日期按 45 天倒推（2026-07-06）', stock0001.some((l) => l.清理日期 === '2026-07-06'))
check('TRAS-0006 上线前清污也是存量补录', logs.some((l) => l.栅体编号 === 'TRAS-0006' && l.来源 === '存量补录'))

console.log('\n[7] 落库失败：整套回滚，无半条记录')
const docBefore = JSON.stringify(getDocument())
armWriteFailure()
const confirmFail = runAction('trashrack', byCode['TRAS-0002'].id, '确认完成', '测试员')
check('落库失败时动作返回失败提示', !confirmFail.ok && confirmFail.message.includes('回滚'))
const docAfter = JSON.stringify(getDocument())
check('回滚后整份文档与失败前逐字节一致', docBefore === docAfter)
const r2 = listEntries('trashrack').items.find((r) => r['栅体编号'] === 'TRAS-0002')
check('TRAS-0002 仍是清理中、压差仍是 1.82、次数仍为 1',
  r2.status === '清理中' && Number(r2['前后压差']) === 1.82 && Number(r2['清污次数']) === 1)
check('存储层也没有半条清污日志', listCleaningLogs().some((l) => l.栅体编号 === 'TRAS-0002' && l.清理日期 === '2026-10-06') === false)

console.log('\n[8] 继电保护：台账为唯一结论来源，重复报送退回仅留痕')
const prot = listEntries('protection').items
const p3 = prot.find((r) => r['装置编号'] === 'PROT-0003')
const led0 = listProtectionLedger().length
const sub1 = runAction('protection', p3.id, '提交校验', '测试员')
check('首次报送「正常」受理成功', sub1.ok, sub1.message)
const p3b = listEntries('protection').items.find((r) => r['装置编号'] === 'PROT-0003')
check('设备状态由异常同步为正常', p3b.status === '正常' && p3b.abnormal === false)
check('上次校验日更新为今天，下次校验日顺延一年', p3b['上次校验日'] === '2026-10-06' && p3b['下次校验日'] === '2027-10-06')
check('台账新增 1 条受理', listProtectionLedger().length === led0 + 1
  && listProtectionLedger().filter((l) => l.接收状态 === '受理').length >= 1)
const sub2 = runAction('protection', p3.id, '提交校验', '测试员')
check('同装置同日同结论重复报送被退回', !sub2.ok && sub2.message.includes('退回'), sub2.message)
const ledger = listProtectionLedger()
const rejected = ledger.filter((l) => l.装置编号 === 'PROT-0003' && l.接收状态 === '退回')
check('退回件留痕 1 条', rejected.length === 1)
const p3c = listEntries('protection').items.find((r) => r['装置编号'] === 'PROT-0003')
check('退回后设备状态仍是正常（退回件不改设备）', p3c.status === '正常')
const ps = protectionSummary()
check('异常台数随受理结论下降为 0', ps.abnormal === 0, String(ps.abnormal))

console.log('\n[9] 存量台账按记录时间回填；早年缺项另行说明')
check('PROT-0004 有 2025-03-05 的受理回填',
  ledger.some((l) => l.装置编号 === 'PROT-0004' && l.记录时间 === '2025-03-05' && l.接收状态 === '受理'))
check('上线前回填带存量补录备注',
  ledger.some((l) => l.装置编号 === 'PROT-0001' && l.备注.includes('平台上线')))
const missing = ledger.filter((l) => l.接收状态 === '缺项说明')
check('PROT-0005 缺校验记录，登记为缺项说明（不虚构）',
  missing.some((l) => l.装置编号 === 'PROT-0005' && l.备注.includes('缺失')))
const p5 = listEntries('protection').items.find((r) => r['装置编号'] === 'PROT-0005')
check('缺项装置按待校验跟踪', p5.status === '待校验')

console.log('\n[10] 跨模块台数一致 & 落库失败保护侧也回滚')
const devices = listEntries('protection').items.length
const devicesInLedger = new Set(ledger.map((l) => l.装置编号)).size
const overviewProt = loadOverview().modules.find((m) => m.name === '继电保护')
check(`台账装置数=${devicesInLedger}、设备台账=${devices}、概览=${overviewProt.created} 三处一致`,
  devicesInLedger === devices && devices === overviewProt.created)
const ledBefore = listProtectionLedger().length
const docBeforeP = JSON.stringify(getDocument())
armWriteFailure()
const subFail = runAction('protection', p3.id, '标记异常', '测试员')
check('保护侧落库失败返回回滚提示', !subFail.ok && subFail.message.includes('回滚'))
check('台账条数未增加', listProtectionLedger().length === ledBefore)
check('整份文档逐字节一致', JSON.stringify(getDocument()) === docBeforeP)

console.log('\n[11] 退出运行：在账台数核减，不再接收报送')
const p4 = listEntries('protection').items.find((r) => r['装置编号'] === 'PROT-0004')
const dec = runAction('protection', p4.id, '退出运行', '测试员')
check('退出成功', dec.ok, dec.message)
const decRow = listEntries('protection').items.find((r) => r['装置编号'] === 'PROT-0004')
check('已退出不计待处理/异常', decRow.status === '已退出' && decRow.pending === false && decRow.abnormal === false)
const subAfterExit = runAction('protection', p4.id, '提交校验', '测试员')
check('已退出装置报送被拒绝', !subAfterExit.ok)

invalidateCache()
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exitCode = 1
}

console.log('\n[12] v1 旧数据迁移：日志/台账按旧行重新回填，三处台数仍一致')
{
  // 造一份 v1 形态（只有 entries 的旧拦污栅/保护占位数据），刷新存储后重新读。
  const v1 = {
    trashrack: [
      { id: 1, status: '待清理', pending: true, abnormal: false, '栅体编号': 'TRAS-X1', '所属机组': '9号机组', '前后压差': 2.1, '清污次数': 2, '清污方式': '人工清污', '清理日期': '2026-08-10', '清理人员': '旧人员', '栅体状态': '' },
    ],
    protection: [
      { id: 1, status: '异常', pending: true, abnormal: true, '装置编号': 'PROT-X1', '保护类型': '旧保护', '定值单号': 'X', '上次校验日': '2026-02-01', '下次校验日': '2026-02-01', '动作次数': 0, '校验人员': '旧人员', '装置状态': '' },
    ],
  }
  globalThis.window.localStorage.setItem('hydropower-plant-om:entries', JSON.stringify(v1))
  invalidateCache()
  const migratedRows = listEntries('trashrack').items
  check('旧栅体迁移后按口径标超限（2.10m）', migratedRows[0]['栅体编号'] === 'TRAS-X1' && migratedRows[0].abnormal === true)
  const migratedLogs = listCleaningLogs().filter((l) => l.栅体编号 === 'TRAS-X1')
  check('旧栅体的 2 次历史清污按日期回填，8 月那次标存量补录',
    migratedLogs.length === 2 && migratedLogs.some((l) => l.清理日期 === '2026-08-10' && l.来源 === '存量补录'))
  const migratedLedger = listProtectionLedger().filter((l) => l.装置编号 === 'PROT-X1')
  check('旧装置按上次校验日补受理台账，结论沿用旧状态「异常」',
    migratedLedger.length === 1 && migratedLedger[0].接收状态 === '受理' && migratedLedger[0].校验结论 === '异常')
  const ov = loadOverview().modules.find((m) => m.name === '继电保护')
  check('迁移后概览装置数与设备台账一致（各 1 台）', ov.created === listEntries('protection').items.length)
}

console.log(`\n最终结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exitCode = 1
}

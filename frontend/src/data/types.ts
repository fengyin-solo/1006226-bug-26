/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 清污记录：每次「确认完成清污」落一条，栅体上的清污次数是它的汇总，不允许各写各的。 */
export type CleaningRecord = {
  id: number
  rackId: number
  rackCode: string
  unit: string
  cleanDate: string
  method: string
  operator: string
  /** 清理前后压差，单位米水柱；确认完成时按同一时点记录，台账与栅体读到同一份。 */
  pressureBefore: number
  pressureAfter: number
  recordedAt: string
  /** 早于平台上线日的存量记录按业务日期回填，置 true。 */
  backfilled: boolean
  note?: string
}

/**
 * 跨模块运行台账：需要被多个模块核对的结论统一先落这条流水。
 * 结论以台账为准（authoritative），各业务表的状态字段只作留痕比对。
 */
export type LedgerRecord = {
  id: number
  /** 来源模块 key，如 trashrack / protection；缺项说明也挂在来源模块下。 */
  module: string
  /** 业务类型：trashrack-cleaning / protection-check / legacy-gap-note。 */
  bizType: string
  /** 幂等键：同一业务结论只能报送一次，后到的一份直接退回。 */
  bizKey: string
  entityRef: string
  /** 业务发生日期：存量数据按实际清理/校验日期回填，不是录入当天。 */
  occurredAt: string
  /** 平台落账时间。 */
  recordedAt: string
  recordedBy: string
  payload: Record<string, string | number | boolean>
  backfilled: boolean
  note?: string
}

/** 动作附加参数（如确认清污时的清理日期、方式、人员）。 */
export type ActionPayload = {
  [key: string]: string
}

/** 应用完整状态：业务表 + 清污记录 + 运行台账，事务一起提交、一起回滚。 */
export type AppState = {
  version: number
  entries: Record<string, EntryRow[]>
  cleaningRecords: CleaningRecord[]
  ledger: LedgerRecord[]
}

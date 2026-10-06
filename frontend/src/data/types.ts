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

/** 拦污栅清污日志：另存的清污清单与列表/清污次序读到的就是这一份。 */
export type CleaningLog = {
  id: number
  栅体编号: string
  所属机组: string
  清理日期: string
  清污方式: string
  清理人员: string
  清前压差: number
  清后压差: number
  来源: '运行登记' | '存量补录'
  备注: string
}

/** 继电保护运行台账记录：设备状态以台账中最新一条「受理」校验结论为准。 */
export type ProtectionLedgerEntry = {
  id: number
  装置编号: string
  保护类型: string
  记录时间: string
  校验结论: '正常' | '异常'
  动作次数: number
  校验人员: string
  接收状态: '受理' | '退回' | '缺项说明'
  备注: string
}

/** 同一份文档：栅体清单、清污日志、保护装置、运行台账一起落库，任一失败整套回滚。 */
export type StoreDocument = {
  version: number
  entries: Record<string, EntryRow[]>
  cleaningLogs: CleaningLog[]
  protectionLedger: ProtectionLedgerEntry[]
}

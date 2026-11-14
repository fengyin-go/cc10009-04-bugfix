/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 作业类模块的生命周期口径：批次、异常结果与作业状态共用这一份定义。 */
export type JobLifecycle = {
  runningStatus: string
  failedStatus: string
  completedStatus: string
  startAction: string
  terminateAction: string
  archiveAction: string
}

/** 采集/执行批次：作业每启动一次对应一条，终止与归档只会修改同一条。 */
export type JobBatch = {
  batchNo: string
  moduleKey: string
  jobId: number
  jobNo: string
  status: string
  startedAt: string
  finishedAt: string
  collectedCount: number
  reason: string
}

/** 失败批次对应的异常记录，异常详情面板直接读这份数据。 */
export type AbnormalResult = {
  id: number
  batchNo: string
  moduleKey: string
  jobId: number
  jobNo: string
  status: string
  reason: string
  collectedCount: number
  createdAt: string
}

/** 状态流转历史：历史作业按当时的流转记录可查，不会随当前状态被改写。 */
export type JobStatusEvent = {
  id: number
  moduleKey: string
  jobId: number
  jobNo: string
  batchNo: string
  action: string
  fromStatus: string
  toStatus: string
  reason: string
  collectedCount: number
  at: string
}

export type RuntimeState = {
  batches: JobBatch[]
  abnormalResults: AbnormalResult[]
  events: JobStatusEvent[]
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
  /**
   * 动作允许的前置状态。声明后服务层按状态机校验，不再允许任意跳转。
   * 未声明该字段的模块保持原有的宽松流转，避免影响其他业务面。
   */
  transitions?: Record<string, string[]>
  /** 结束态：进入后不允许再回到任何非结束态。 */
  terminalStatuses?: string[]
  /** 作业类模块才会声明，页面据此渲染批次与异常详情。 */
  jobLifecycle?: JobLifecycle
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionOptions = {
  /** 页面点击时携带的状态，用于发现列表已被其他操作刷新。 */
  expectedStatus?: string
  /** 终止原因；缺省时优先沿用作业上已有的终止原因。 */
  reason?: string
  /** 已有部分结果时由调用方透传，服务层也会优先保留行上已有条数。 */
  collectedCount?: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 重复点击被幂等忽略时为 true，不会重复写批次、历史或异常记录。 */
  duplicate?: boolean
  /** 提交失败时返回被恢复到的状态，便于页面提示恢复点。 */
  recoveryPoint?: string
  status?: string
  batchNo?: string
}

export type RunningJobView = {
  moduleKey: string
  moduleName: string
  jobId: number
  jobNo: string
  status: string
  batchNo: string
  collectedCount: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  runningJobs: RunningJobView[]
  abnormalResults: AbnormalResult[]
}

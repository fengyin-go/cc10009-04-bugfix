import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  readRuntime,
  resetRows,
  resetRuntime,
  saveRows,
  saveRuntime,
  setCachedRows,
  setCachedRuntime,
} from '@/data/local-store'
import type {
  AbnormalResult,
  ActionOptions,
  ActionResult,
  EntryRow,
  JobBatch,
  JobStatusEvent,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RunningJobView,
  RuntimeState,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const BATCH_FIELDS: Record<string, string> = {
  spider: '当前批次',
  rpaflow: '执行批次',
}

const COLLECTED_FIELD = '已采集条数'
const REASON_FIELD = '终止原因'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 某条作业的批次（每次启动一条，终止与归档只改同一条）。 */
export function listJobBatches(key: string, jobId?: number): JobBatch[] {
  return readRuntime().batches.filter(
    (batch) => batch.moduleKey === key && (jobId === undefined || batch.jobId === Number(jobId)),
  )
}

/** 全部业务面的批次台账，作业清单页与异常详情面板共用。 */
export function listAllJobBatches(): JobBatch[] {
  return readRuntime().batches
}

/** 失败批次对应的异常记录；不传 key 时返回全部业务面。 */
export function listAbnormalResults(key?: string): AbnormalResult[] {
  const results = readRuntime().abnormalResults
  return key ? results.filter((item) => item.moduleKey === key) : results
}

/** 历史流转记录：按当时的状态可查，不随当前状态被改写。 */
export function listJobEvents(key?: string, jobId?: number): JobStatusEvent[] {
  return readRuntime().events.filter(
    (event) =>
      (!key || event.moduleKey === key) && (jobId === undefined || event.jobId === Number(jobId)),
  )
}

/** 运行中作业清单：作业清单页和运营概览共用这份数据。 */
export function listRunningJobs(): RunningJobView[] {
  const rows = allRows()
  const runtime = readRuntime()
  const views: RunningJobView[] = []
  for (const meta of MODULE_BY_KEY.values()) {
    const lifecycle = meta.jobLifecycle
    if (!lifecycle) {
      continue
    }
    for (const row of rows[meta.key] ?? []) {
      if (String(row.status) !== lifecycle.runningStatus) {
        continue
      }
      const openBatch = runtime.batches.find(
        (batch) =>
          batch.moduleKey === meta.key &&
          batch.jobId === Number(row.id) &&
          batch.status === lifecycle.runningStatus,
      )
      const batchCount = openBatch?.collectedCount ?? 0
      views.push({
        moduleKey: meta.key,
        moduleName: meta.name,
        jobId: Number(row.id),
        jobNo: jobNoOf(meta, row),
        status: String(row.status),
        batchNo: openBatch?.batchNo ?? String(row[batchFieldOf(meta)] ?? ''),
        collectedCount: Math.max(batchCount, numericField(row[COLLECTED_FIELD])),
      })
    }
  }
  return views
}

function jobNoOf(meta: ModuleMeta, row: EntryRow): string {
  return String(row[meta.fields[0]] ?? row.id)
}

function batchFieldOf(meta: ModuleMeta): string {
  return BATCH_FIELDS[meta.key] ?? '当前批次'
}

function numericField(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function isJobModule(meta: ModuleMeta): boolean {
  return Boolean(meta.jobLifecycle && meta.transitions)
}

function pendingFor(meta: ModuleMeta, status: string): boolean {
  const lifecycle = meta.jobLifecycle
  if (!lifecycle) {
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    return status !== lastStatus
  }
  return status !== lifecycle.runningStatus && status !== lifecycle.failedStatus && status !== lifecycle.completedStatus
}

function nextEventId(runtime: RuntimeState): number {
  return runtime.events.reduce((max, event) => Math.max(max, event.id), 0) + 1
}

function nextAbnormalId(runtime: RuntimeState): number {
  return runtime.abnormalResults.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 取当前作业对应的批次。
 * 同一作业在运行中只允许存在一条批次：断线重开后沿用持久化的那条，不会另起一条作业。
 */
function resolveOpenBatch(
  meta: ModuleMeta,
  runtime: RuntimeState,
  row: EntryRow,
): JobBatch | undefined {
  const lifecycle = meta.jobLifecycle!
  return runtime.batches.find(
    (batch) =>
      batch.moduleKey === meta.key &&
      batch.jobId === Number(row.id) &&
      batch.status === lifecycle.runningStatus,
  )
}

function createBatch(
  meta: ModuleMeta,
  runtime: RuntimeState,
  row: EntryRow,
  status: string,
  collectedCount = 0,
  reason = '',
): JobBatch {
  const jobId = Number(row.id)
  const jobNo = jobNoOf(meta, row)
  const runIndex =
    runtime.batches.filter((batch) => batch.moduleKey === meta.key && batch.jobId === jobId).length + 1
  return {
    batchNo: `${jobNo}-B${runIndex}`,
    moduleKey: meta.key,
    jobId,
    jobNo,
    status,
    startedAt: nowIso(),
    finishedAt: status === meta.jobLifecycle!.runningStatus ? '' : nowIso(),
    collectedCount: numericField(collectedCount),
    reason,
  }
}

function commitRows(key: string, nextRows: EntryRow[]): { ok: true } | { ok: false; error: unknown } {
  const previousRows = listRows(key)
  try {
    saveRows(key, nextRows)
    return { ok: true }
  } catch (error) {
    setCachedRows(key, previousRows)
    try {
      saveRows(key, previousRows)
    } catch {
      setCachedRows(key, previousRows)
    }
    return { ok: false, error }
  }
}

/**
 * 作业批次与业务行必须一起提交：任一写入失败就整体退回原状态，并保留恢复点。
 * 只改内存、不碰持久层的失败场景下，页面重新读取仍是原来的运行中状态。
 */
function commit(
  key: string,
  nextRows: EntryRow[],
  nextRuntime: RuntimeState,
): { ok: true } | { ok: false; error: unknown } {
  const previousRows = listRows(key)
  const previousRuntime = readRuntime()
  try {
    saveRows(key, nextRows)
    saveRuntime(nextRuntime)
    return { ok: true }
  } catch (error) {
    // 先恢复内存，再尽力把已经写出去的半成品数据改回原值。
    setCachedRows(key, previousRows)
    setCachedRuntime(previousRuntime)
    try {
      saveRows(key, previousRows)
    } catch {
      setCachedRows(key, previousRows)
    }
    try {
      saveRuntime(previousRuntime)
    } catch {
      setCachedRuntime(previousRuntime)
    }
    return { ok: false, error }
  }
}

function appendEvent(
  runtime: RuntimeState,
  meta: ModuleMeta,
  row: EntryRow,
  batchNo: string,
  action: string,
  fromStatus: string,
  toStatus: string,
  reason: string,
  collectedCount: number,
): void {
  runtime.events.push({
    id: nextEventId(runtime),
    moduleKey: meta.key,
    jobId: Number(row.id),
    jobNo: jobNoOf(meta, row),
    batchNo,
    action,
    fromStatus,
    toStatus,
    reason,
    collectedCount,
    at: nowIso(),
  })
}

function appendAbnormal(
  runtime: RuntimeState,
  meta: ModuleMeta,
  row: EntryRow,
  batch: JobBatch,
): void {
  // 同一失败批次只登记一次异常记录；重复点击或断线重连都不会新增第二条。
  if (runtime.abnormalResults.some((item) => item.batchNo === batch.batchNo)) {
    return
  }
  runtime.abnormalResults.push({
    id: nextAbnormalId(runtime),
    batchNo: batch.batchNo,
    moduleKey: meta.key,
    jobId: Number(row.id),
    jobNo: jobNoOf(meta, row),
    status: batch.status,
    reason: batch.reason,
    collectedCount: batch.collectedCount,
    createdAt: nowIso(),
  })
}

function invalidTransition(
  meta: ModuleMeta,
  current: string,
  action: string,
): ActionResult {
  const allowed = meta.transitions?.[action] ?? []
  const lifecycle = meta.jobLifecycle
  if (
    lifecycle &&
    action === lifecycle.archiveAction &&
    current === lifecycle.failedStatus &&
    meta.terminalStatuses?.includes(current)
  ) {
    return {
      ok: false,
      status: current,
      message: `${meta.entity}已因终止进入「${current}」，归档被拒绝，先到的终止状态继续生效`,
    }
  }
  return {
    ok: false,
    status: current,
    message: `${meta.entity}当前为「${current}」，不能执行「${action}」${
      allowed.length ? `，只允许从「${allowed.join('、')}」发起` : ''
    }`,
  }
}

function duplicateResult(meta: ModuleMeta, current: string, action: string, batchNo: string): ActionResult {
  return {
    ok: true,
    duplicate: true,
    status: current,
    batchNo,
    message: `${meta.entity}已处于「${current}」，本次重复的「${action}」已忽略`,
  }
}

function runJobAction(
  meta: ModuleMeta,
  row: EntryRow,
  action: string,
  options: ActionOptions,
): ActionResult {
  const lifecycle = meta.jobLifecycle!
  const rows = listRows(meta.key)
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${row.id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  const target = meta.actionTargets[action]
  const runtime = readRuntime()
  const batchField = batchFieldOf(meta)

  // 重复点击：同一动作已经生效时只处理一次，不再写批次、历史或异常记录。
  const failedBatch = runtime.batches.find(
    (batch) =>
      batch.moduleKey === meta.key &&
      batch.jobId === Number(row.id) &&
      batch.status === lifecycle.failedStatus,
  )

  if (action === lifecycle.terminateAction && current === lifecycle.failedStatus) {
    // 兼容历史失败记录：缺异常记录时补登一次，之后重复点击不再处理。
    if (failedBatch) {
      const nextRuntime = { ...runtime, abnormalResults: [...runtime.abnormalResults] }
      appendAbnormal(nextRuntime, meta, rows[index], failedBatch)
      if (nextRuntime.abnormalResults.length !== runtime.abnormalResults.length) {
        const committed = commit(meta.key, rows, nextRuntime)
        if (!committed.ok) {
          return {
            ok: false,
            status: current,
            recoveryPoint: current,
            message: `${meta.entity}异常记录提交失败，状态保持在「${current}」`,
          }
        }
      }
    }
    return duplicateResult(meta, current, action, failedBatch?.batchNo ?? String(rows[index][batchField] ?? ''))
  }

  if (action === lifecycle.archiveAction && current === lifecycle.completedStatus) {
    return duplicateResult(meta, current, action, String(rows[index][batchField] ?? ''))
  }

  if (action === lifecycle.startAction && current === lifecycle.runningStatus) {
    // 已在运行中：沿用已有批次；只有第一次看到这条运行记录时才补建批次。
    const openBatch = resolveOpenBatch(meta, runtime, rows[index])
    if (openBatch) {
      return duplicateResult(meta, current, action, openBatch.batchNo)
    }
    const nextRuntime = { ...runtime, batches: [...runtime.batches] }
    const batch = createBatch(meta, nextRuntime, rows[index], lifecycle.runningStatus)
    nextRuntime.batches.push(batch)
    const nextRows = [...rows]
    nextRows[index] = { ...rows[index], [batchField]: batch.batchNo }
    const committed = commit(meta.key, nextRows, nextRuntime)
    if (!committed.ok) {
      return {
        ok: false,
        status: current,
        recoveryPoint: current,
        message: `${meta.entity}批次提交失败，状态保持在「${current}」`,
      }
    }
    return duplicateResult(meta, current, action, batch.batchNo)
  }

  if (current === target) {
    return duplicateResult(meta, current, action, String(rows[index][batchField] ?? ''))
  }

  // 状态机校验：只允许按 transitions 声明的边推进，既不能跳级也不能回退。
  // 终止与归档冲突时，先到的合法状态（如已失败）在这里直接生效，后到的动作被拒绝。
  if (!meta.transitions?.[action]?.includes(current)) {
    return invalidTransition(meta, current, action)
  }

  // 页面带来的状态与库里不一致：说明列表已被其他操作更新，先刷新再操作。
  if (options.expectedStatus && options.expectedStatus !== current) {
    return {
      ok: false,
      status: current,
      message: `${meta.entity}状态已变为「${current}」，请刷新后再操作`,
    }
  }

  const nextRows = [...rows]
  const nextRuntime: RuntimeState = {
    ...runtime,
    batches: [...runtime.batches],
    abnormalResults: [...runtime.abnormalResults],
    events: [...runtime.events],
  }

  if (action === lifecycle.startAction) {
    const openBatch = resolveOpenBatch(meta, nextRuntime, rows[index])
    const batch =
      openBatch ?? createBatch(meta, nextRuntime, rows[index], lifecycle.runningStatus)
    if (!openBatch) {
      nextRuntime.batches.push(batch)
    }
    nextRows[index] = {
      ...rows[index],
      status: target,
      pending: false,
      abnormal: false,
      [batchField]: batch.batchNo,
      [COLLECTED_FIELD]: 0,
      [REASON_FIELD]: '',
    }
    appendEvent(nextRuntime, meta, rows[index], batch.batchNo, action, current, target, '', 0)
    const committed = commit(meta.key, nextRows, nextRuntime)
    if (!committed.ok) {
      return {
        ok: false,
        status: current,
        recoveryPoint: current,
        message: `${meta.entity}状态提交失败，已退回「${current}」，恢复点：${current}`,
      }
    }
    return {
      ok: true,
      status: target,
      batchNo: batch.batchNo,
      message: `${meta.entity}已${action}，当前状态「${target}」，批次 ${batch.batchNo}`,
    }
  }

  if (action === lifecycle.terminateAction) {
    const openBatch = resolveOpenBatch(meta, nextRuntime, rows[index])
    const synthetic = openBatch
      ? undefined
      : createBatch(meta, nextRuntime, rows[index], lifecycle.runningStatus)
    const collectedCount =
      options.collectedCount !== undefined
        ? Math.max(
            numericField(options.collectedCount),
            numericField(rows[index][COLLECTED_FIELD]),
            openBatch?.collectedCount ?? 0,
          )
        : Math.max(numericField(rows[index][COLLECTED_FIELD]), openBatch?.collectedCount ?? 0)
    const reason =
      (options.reason ?? '').trim() ||
      String(rows[index][REASON_FIELD] ?? '').trim() ||
      openBatch?.reason ||
      '手动终止'
    const failedBatch: JobBatch = {
      ...(openBatch ?? synthetic!),
      status: lifecycle.failedStatus,
      finishedAt: nowIso(),
      collectedCount,
      reason,
    }
    // 同一条作业只保留一条批次记录：有运行中批次就原地改为失败，没有就补建一条失败批次。
    const batchIndex = openBatch
      ? nextRuntime.batches.findIndex((batch) => batch.batchNo === openBatch.batchNo)
      : -1
    if (batchIndex >= 0) {
      nextRuntime.batches[batchIndex] = failedBatch
    } else {
      nextRuntime.batches.push(failedBatch)
    }
    appendAbnormal(nextRuntime, meta, rows[index], failedBatch)
    appendEvent(nextRuntime, meta, rows[index], failedBatch.batchNo, action, current, target, reason, collectedCount)
    nextRows[index] = {
      ...rows[index],
      status: target,
      pending: false,
      abnormal: true,
      [batchField]: failedBatch.batchNo,
      [COLLECTED_FIELD]: collectedCount,
      [REASON_FIELD]: reason,
    }
    const committed = commit(meta.key, nextRows, nextRuntime)
    if (!committed.ok) {
      return {
        ok: false,
        status: current,
        recoveryPoint: current,
        message: `${meta.entity}终止提交失败，已退回「${current}」，恢复点：${current}，批次 ${failedBatch.batchNo}`,
      }
    }
    return {
      ok: true,
      status: target,
      batchNo: failedBatch.batchNo,
      message: `${meta.entity}已${action}，当前状态「${target}」，保留已采集 ${collectedCount} 条`,
    }
  }

  if (action === lifecycle.archiveAction) {
    const openBatch = resolveOpenBatch(meta, nextRuntime, rows[index])
    const synthetic = openBatch
      ? undefined
      : createBatch(meta, nextRuntime, rows[index], lifecycle.runningStatus)
    const collectedCount = options.collectedCount !== undefined
      ? Math.max(
          numericField(options.collectedCount),
          numericField(rows[index][COLLECTED_FIELD]),
          openBatch?.collectedCount ?? 0,
        )
      : Math.max(numericField(rows[index][COLLECTED_FIELD]), openBatch?.collectedCount ?? 0)
    const completedBatch: JobBatch = {
      ...(openBatch ?? synthetic!),
      status: lifecycle.completedStatus,
      finishedAt: nowIso(),
      collectedCount,
      reason: '',
    }
    // 与终止相同：复用运行中批次，绝不因为归档再生成第二条批次/作业。
    const batchIndex = openBatch
      ? nextRuntime.batches.findIndex((batch) => batch.batchNo === openBatch.batchNo)
      : -1
    if (batchIndex >= 0) {
      nextRuntime.batches[batchIndex] = completedBatch
    } else {
      nextRuntime.batches.push(completedBatch)
    }
    appendEvent(nextRuntime, meta, rows[index], completedBatch.batchNo, action, current, target, '', collectedCount)
    nextRows[index] = {
      ...rows[index],
      status: target,
      pending: false,
      abnormal: false,
      [batchField]: completedBatch.batchNo,
      [COLLECTED_FIELD]: collectedCount,
      [REASON_FIELD]: '',
    }
    const committed = commit(meta.key, nextRows, nextRuntime)
    if (!committed.ok) {
      return {
        ok: false,
        status: current,
        recoveryPoint: current,
        message: `${meta.entity}归档提交失败，已退回「${current}」，恢复点：${current}，批次 ${completedBatch.batchNo}`,
      }
    }
    return {
      ok: true,
      status: target,
      batchNo: completedBatch.batchNo,
      message: `${meta.entity}已${action}，当前状态「${target}」，批次 ${completedBatch.batchNo}`,
    }
  }

  // 前序推进动作（如提交执行）：照常推进状态，同时记一条流转历史。
  nextRows[index] = {
    ...rows[index],
    status: target,
    pending: pendingFor(meta, target),
    abnormal: false,
    [REASON_FIELD]: '',
  }
  const batchNo = String(rows[index][batchField] ?? '')
  appendEvent(nextRuntime, meta, rows[index], batchNo, action, current, target, '', 0)
  const committed = commit(meta.key, nextRows, nextRuntime)
  if (!committed.ok) {
    return {
      ok: false,
      status: current,
      recoveryPoint: current,
      message: `${meta.entity}状态提交失败，已退回「${current}」，恢复点：${current}`,
    }
  }
  return { ok: true, status: target, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options: ActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  if (isJobModule(meta)) {
    return runJobAction(meta, rows[index], action, options)
  }

  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, status: current, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  const committed = commitRows(key, next)
  if (!committed.ok) {
    return {
      ok: false,
      status: current,
      recoveryPoint: current,
      message: `${meta.entity}状态提交失败，已退回「${current}」，恢复点：${current}`,
    }
  }
  return { ok: true, status: target, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 记录运行中作业的已采集条数。只改运行中的批次，终止后不会被后续写入覆盖，
 * 保证终止时能保留“已有部分结果”的条数。
 */
export function recordJobProgress(key: string, id: number, collectedCount: number): ActionResult {
  const meta = moduleMeta(key)
  if (!isJobModule(meta)) {
    return { ok: false, message: `${meta.entity}不是作业类记录，没有采集进度` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const lifecycle = meta.jobLifecycle!
  const current = String(rows[index].status)
  if (current !== lifecycle.runningStatus) {
    return {
      ok: false,
      status: current,
      message: `${meta.entity}当前为「${current}」，只有运行中的作业才记录采集进度`,
    }
  }
  const runtime = readRuntime()
  const openBatch = resolveOpenBatch(meta, runtime, rows[index])
  if (!openBatch) {
    return { ok: false, status: current, message: `${meta.entity}没有运行中的批次，请先启动采集` }
  }
  const count = Math.max(numericField(collectedCount), 0)
  const nextRuntime: RuntimeState = {
    ...runtime,
    batches: runtime.batches.map((batch) =>
      batch.batchNo === openBatch.batchNo ? { ...batch, collectedCount: count } : batch,
    ),
  }
  const nextRows = [...rows]
  nextRows[index] = { ...rows[index], [COLLECTED_FIELD]: count }
  const committed = commit(meta.key, nextRows, nextRuntime)
  if (!committed.ok) {
    return {
      ok: false,
      status: current,
      recoveryPoint: current,
      message: `${meta.entity}采集进度提交失败，保持在「${current}」`,
    }
  }
  return {
    ok: true,
    status: current,
    batchNo: openBatch.batchNo,
    message: `${meta.entity}已记录采集 ${count} 条`,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  resetRuntime(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function countAbnormal(rows: EntryRow[]): number {
  return rows.filter((row) => row.abnormal).length
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: countAbnormal(entries),
    }
  })
  const runningJobs = listRunningJobs()
  const abnormalResults = listAbnormalResults()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '运行中作业', value: runningJobs.length },
    { label: '失败批次', value: abnormalResults.length },
  ]
  return { cards, modules, runningJobs, abnormalResults }
}

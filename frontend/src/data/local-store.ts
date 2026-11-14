import { SEED_ROWS } from './seed'
import type { EntryRow, RuntimeState } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'scraper-config-studio:entries'
// 作业批次、异常结果与状态流转历史和业务数据分仓保存：断线重开后按原批次恢复。
const RUNTIME_KEY = 'scraper-config-studio:runtime'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function emptyRuntime(): RuntimeState {
  return { batches: [], abnormalResults: [], events: [] }
}

// 作业类模块新增的运行时字段：老数据没有时补默认值，避免读取链路因缺字段错位。
const JOB_FIELD_DEFAULTS: Record<string, Record<string, string | number>> = {
  spider: { 当前批次: '', 已采集条数: 0, 终止原因: '' },
  rpaflow: { 执行批次: '', 已采集条数: 0, 终止原因: '' },
}

function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const defaults = JOB_FIELD_DEFAULTS[key]
  if (!defaults) {
    return rows
  }
  return rows.map((row) => {
    const next = { ...row }
    for (const [field, value] of Object.entries(defaults)) {
      if (next[field] === undefined) {
        next[field] = value
      }
    }
    return next
  })
}

function normalizeAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = { ...data }
  for (const key of Object.keys(JOB_FIELD_DEFAULTS)) {
    if (Array.isArray(next[key])) {
      next[key] = normalizeRows(key, next[key])
    }
  }
  return next
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return normalizeAll({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let runtimeCache: RuntimeState | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  // 先落盘再更新内存：写入失败时内存里仍是旧数据，调用方可以据此回滚。
  if (hasStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

/** 只改内存缓存，用于提交失败后的回滚（持久层可能仍不可写）。 */
export function setCachedRows(key: string, rows: EntryRow[]): void {
  cache = { ...allRows(), [key]: rows }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function readRuntime(): RuntimeState {
  if (runtimeCache !== null) {
    return runtimeCache
  }
  if (!hasStorage()) {
    runtimeCache = emptyRuntime()
    return runtimeCache
  }
  const raw = window.localStorage.getItem(RUNTIME_KEY)
  if (!raw) {
    runtimeCache = emptyRuntime()
    return runtimeCache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeState>
    runtimeCache = {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      abnormalResults: Array.isArray(parsed.abnormalResults) ? parsed.abnormalResults : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    }
  } catch {
    runtimeCache = emptyRuntime()
  }
  return runtimeCache
}

export function saveRuntime(runtime: RuntimeState): void {
  if (hasStorage()) {
    window.localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime))
  }
  runtimeCache = runtime
}

/** 只改内存缓存，用于提交失败后的回滚（持久层可能仍不可写）。 */
export function setCachedRuntime(runtime: RuntimeState): void {
  runtimeCache = runtime
}

export function resetRuntime(key: string): void {
  const runtime = readRuntime()
  const next: RuntimeState = {
    ...runtime,
    batches: runtime.batches.filter((batch) => batch.moduleKey !== key),
    abnormalResults: runtime.abnormalResults.filter((item) => item.moduleKey !== key),
    events: runtime.events.filter((event) => event.moduleKey !== key),
  }
  saveRuntime(next)
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function runtimeStorageKey(): string {
  return RUNTIME_KEY
}

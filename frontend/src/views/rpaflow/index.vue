<template>
  <section class="page" data-module="rpaflow">
    <header class="page-head">
      <div>
        <h2>RPA流程管理</h2>
        <p class="page-desc">维护RPA自动化流程的输入、执行约束与结果记录，为RPA流程提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记自动化流程</button>
        <button class="btn" type="button" @click="exportRows">导出RPA流程清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="noticeMessage" class="notice-text" data-testid="rpaflow-notice">{{ noticeMessage }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :class="{ 'link-muted': !canRun(action, row) }"
              :title="canRun(action, row) ? action : `当前状态「${row.status}」不能${action}`"
              :data-action="action"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无RPA流程数据，可先登记自动化流程</td>
        </tr>
      </tbody>
    </table>

    <JobRuntimePanel :version="runtimeVersion" />

    <footer class="page-foot">
      <span>共 {{ total }} 条RPA流程记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import JobRuntimePanel from '@/components/JobRuntimePanel.vue'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('rpaflow')
const columns = ["流程编号", "目标页面", "操作序列", "等待条件", "超时秒数", "结果提取", "异常回滚", "执行批次", "已采集条数", "终止原因"]
const actions = ["提交执行", "启动流程", "终止流程", "归档结果"]
const statuses = ["草稿", "待校验", "执行中", "已完成", "已失败"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const runtimeVersion = ref(0)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: "自动化流程总数", value: total.value },
  { label: "执行中流程", value: rows.value.filter((row) => row.status === '执行中').length },
  { label: "已完成流程", value: rows.value.filter((row) => row.status === '已完成').length },
])

/** RPA 业务面与采集作业共用同一套状态机口径。 */
function canRun(action: string, row: EntryRow): boolean {
  return Boolean(meta.transitions?.[action]?.includes(String(row.status)))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '自动化流程登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    expectedStatus: String(row.status),
    collectedCount: Number(row['已采集条数'] ?? 0),
    reason: String(row['终止原因'] ?? ''),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'RPA流程列表读取失败'
  }
  // 同步刷新台账：采集任务侧的运行中作业与失败批次也要在这个入口可见。
  runtimeVersion.value += 1
}

onMounted(reload)
</script>

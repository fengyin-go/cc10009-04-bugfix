<template>
  <section class="page" data-module="jobs">
    <header class="page-head">
      <div>
        <h2>作业清单</h2>
        <p class="page-desc">汇总采集任务与 RPA 流程的作业状态。终止、归档与异常结果都在这里同步，和采集任务页看到的是同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">刷新清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <table class="data-table" data-testid="job-list">
      <thead>
        <tr>
          <th>业务面</th>
          <th>作业编号</th>
          <th>当前状态</th>
          <th>当前批次</th>
          <th>已采集条数</th>
          <th>终止原因</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="job in jobs"
          :key="`${job.moduleKey}-${job.jobId}`"
          :data-module="job.moduleKey"
          :data-job-id="job.jobId"
          data-testid="job-list-row"
        >
          <td>{{ job.moduleName }}</td>
          <td>{{ job.jobNo }}</td>
          <td>{{ job.status }}</td>
          <td>{{ job.batchNo || '—' }}</td>
          <td>{{ job.collectedCount }}</td>
          <td>{{ job.reason || '—' }}</td>
        </tr>
        <tr v-if="!jobs.length">
          <td colspan="6" class="empty-state">暂无作业数据</td>
        </tr>
      </tbody>
    </table>

    <JobRuntimePanel :version="runtimeVersion" />

    <footer class="page-foot">
      <span>运行中作业终止后会立即从本清单移除，并进入异常详情面板</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listAbnormalResults, listEntries, moduleMeta } from '@/api/local-service'
import JobRuntimePanel from '@/components/JobRuntimePanel.vue'
import type { EntryRow } from '@/data/types'

type JobRow = {
  moduleKey: string
  moduleName: string
  jobId: number
  jobNo: string
  status: string
  batchNo: string
  collectedCount: number
  reason: string
}

const jobs = ref<JobRow[]>([])
const runtimeVersion = ref(0)
const errorMessage = ref('')

const cards = computed(() => [
  { label: '运行中作业', value: jobs.value.filter((job) => isRunning(job)).length },
  { label: '失败批次', value: listAbnormalResults().length },
  {
    label: '已完成作业',
    value: jobs.value.filter((job) => job.status === moduleMeta(job.moduleKey).jobLifecycle?.completedStatus).length,
  },
])

function isRunning(job: JobRow): boolean {
  return job.status === moduleMeta(job.moduleKey).jobLifecycle?.runningStatus
}

function collectJobs(): JobRow[] {
  const result: JobRow[] = []
  for (const key of ['spider', 'rpaflow']) {
    const meta = moduleMeta(key)
    const lifecycle = meta.jobLifecycle
    if (!lifecycle) {
      continue
    }
    for (const row of listEntries(key).items) {
      result.push({
        moduleKey: key,
        moduleName: meta.name,
        jobId: Number(row.id),
        jobNo: String(row[meta.fields[0]] ?? row.id),
        status: String(row.status),
        batchNo: String(row['当前批次'] ?? row['执行批次'] ?? ''),
        collectedCount: Number(row['已采集条数'] ?? 0),
        reason: String(row['终止原因'] ?? ''),
      })
    }
  }
  return result
}

function refresh() {
  errorMessage.value = ''
  try {
    jobs.value = collectJobs()
    runtimeVersion.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '作业清单读取失败'
  }
}

onMounted(refresh)
</script>

<template>
  <section class="job-runtime" data-testid="job-runtime-panel">
    <div class="panel" data-testid="running-jobs">
      <header class="panel-head">
        <h3>运行中作业清单</h3>
        <span class="panel-count">{{ runningJobs.length }} 条</span>
      </header>
      <p class="panel-desc">采集任务与 RPA 流程共用同一份台账，任一业务面终止后这里会同步消失。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>业务面</th>
            <th>作业编号</th>
            <th>当前状态</th>
            <th>当前批次</th>
            <th>已采集条数</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="job in runningJobs"
            :key="`${job.moduleKey}-${job.jobId}`"
            :data-module="job.moduleKey"
            :data-job-id="job.jobId"
            data-testid="running-job-row"
          >
            <td>{{ job.moduleName }}</td>
            <td>{{ job.jobNo }}</td>
            <td>{{ job.status }}</td>
            <td>{{ job.batchNo || '—' }}</td>
            <td>{{ job.collectedCount }}</td>
          </tr>
          <tr v-if="!runningJobs.length">
            <td colspan="5" class="empty-state">当前没有运行中的作业</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel" data-testid="abnormal-results">
      <header class="panel-head">
        <h3>异常详情面板</h3>
        <span class="panel-count">{{ abnormalResults.length }} 条失败批次</span>
      </header>
      <p class="panel-desc">终止产生的失败批次必须进入异常记录；已完成批次不会出现在这里。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>业务面</th>
            <th>作业编号</th>
            <th>批次状态</th>
            <th>终止原因</th>
            <th>已采集条数</th>
            <th>登记时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in abnormalResults"
            :key="item.batchNo"
            :data-module="item.moduleKey"
            data-testid="abnormal-result-row"
          >
            <td>{{ item.batchNo }}</td>
            <td>{{ moduleName(item.moduleKey) }}</td>
            <td>{{ item.jobNo }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.reason || '—' }}</td>
            <td>{{ item.collectedCount }}</td>
            <td>{{ formatTime(item.createdAt) }}</td>
          </tr>
          <tr v-if="!abnormalResults.length">
            <td colspan="7" class="empty-state">暂无失败批次</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel" data-testid="batch-ledger">
      <header class="panel-head">
        <h3>采集批次台账</h3>
        <span class="panel-count">{{ batches.length }} 条批次</span>
      </header>
      <p class="panel-desc">每条作业每次启动只对应一个批次，终止与归档都只改这一条，不会另生成作业。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>业务面</th>
            <th>作业编号</th>
            <th>批次状态</th>
            <th>终止原因</th>
            <th>已采集条数</th>
            <th>开始时间</th>
            <th>结束时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="batch in batches"
            :key="batch.batchNo"
            :data-module="batch.moduleKey"
            data-testid="batch-row"
          >
            <td>{{ batch.batchNo }}</td>
            <td>{{ moduleName(batch.moduleKey) }}</td>
            <td>{{ batch.jobNo }}</td>
            <td>{{ batch.status }}</td>
            <td>{{ batch.reason || '—' }}</td>
            <td>{{ batch.collectedCount }}</td>
            <td>{{ formatTime(batch.startedAt) }}</td>
            <td>{{ formatTime(batch.finishedAt) }}</td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="8" class="empty-state">暂无批次记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel" data-testid="job-history">
      <header class="panel-head">
        <h3>作业流转历史</h3>
        <span class="panel-count">{{ events.length }} 条记录</span>
      </header>
      <p class="panel-desc">历史作业按当时的流转记录可查，当前状态变化不会改写历史。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>业务面</th>
            <th>作业编号</th>
            <th>动作</th>
            <th>原状态</th>
            <th>新状态</th>
            <th>批次号</th>
            <th>终止原因</th>
            <th>已采集条数</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="event in events"
            :key="event.id"
            :data-module="event.moduleKey"
            data-testid="job-history-row"
          >
            <td>{{ formatTime(event.at) }}</td>
            <td>{{ moduleName(event.moduleKey) }}</td>
            <td>{{ event.jobNo }}</td>
            <td>{{ event.action }}</td>
            <td>{{ event.fromStatus }}</td>
            <td>{{ event.toStatus }}</td>
            <td>{{ event.batchNo || '—' }}</td>
            <td>{{ event.reason || '—' }}</td>
            <td>{{ event.collectedCount }}</td>
          </tr>
          <tr v-if="!events.length">
            <td colspan="9" class="empty-state">暂无流转记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import {
  listAbnormalResults,
  listAllJobBatches,
  listJobEvents,
  listRunningJobs,
  moduleMeta,
} from '@/api/local-service'
import type { AbnormalResult, JobBatch, JobStatusEvent, RunningJobView } from '@/data/types'

const props = defineProps<{
  /** 页面动作完成后自增，用来重新读取台账。 */
  version?: number
}>()

const runningJobs = ref<RunningJobView[]>([])
const abnormalResults = ref<AbnormalResult[]>([])
const batches = ref<JobBatch[]>([])
const events = ref<JobStatusEvent[]>([])

function moduleName(key: string): string {
  return moduleMeta(key).name
}

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function refresh() {
  runningJobs.value = listRunningJobs()
  abnormalResults.value = listAbnormalResults()
  batches.value = listAllJobBatches()
  events.value = listJobEvents()
}

watch(() => props.version, refresh)
refresh()
</script>

<script lang="ts">
export default {
  name: 'JobRuntimePanel',
}
</script>

<style scoped>
.job-runtime { display: flex; flex-direction: column; gap: 12px; margin: 12px 0; }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; }
.panel-head h3 { margin: 0; font-size: 14px; }
.panel-count { color: var(--muted); font-size: 12px; }
.panel-desc { color: var(--muted); font-size: 12px; margin: 4px 0 8px; }
</style>

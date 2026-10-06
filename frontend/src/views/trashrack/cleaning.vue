<template>
  <section class="page" data-module="trashrack-cleaning">
    <header class="page-head">
      <div>
        <h2>清污次序</h2>
        <p class="page-desc">
          待清理栅体按前后压差从大到小排队，压差超限位列最前。确认完成后压差恢复、栅体移出队列，
          本页、栅体列表与另存的清污清单读到的是同一份数据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="exportLogs">导出清污清单</button>
        <button class="btn" type="button" @click="goBack">返回栅体列表</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待清理台数</span>
        <strong class="stat-value" :class="{ 'stat-warn': queue.length > 0 }">{{ queue.length }}</strong>
      </article>
      <article class="stat-card tone-danger">
        <span class="stat-label">其中压差超限</span>
        <strong class="stat-value">{{ overCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已清理（不在队）</span>
        <strong class="stat-value">{{ cleanedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">清污清单累计条数</span>
        <strong class="stat-value">{{ logs.length }}</strong>
      </article>
    </div>

    <h3 class="section-title">待清理队列（优先次序）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>优先次序</th>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>当前状态</th>
          <th>前后压差</th>
          <th>已清污次数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in queue" :key="String(row.id)">
          <td>{{ index + 1 }}</td>
          <td>{{ row['栅体编号'] }}</td>
          <td>{{ row['所属机组'] }}</td>
          <td>{{ row.status }}</td>
          <td :class="{ 'danger-text': isOver(row) }">
            {{ formatPressure(row['前后压差']) }}<small v-if="isOver(row)"> 超限</small>
          </td>
          <td>{{ row['清污次数'] }}</td>
          <td class="row-actions">
            <button v-if="row.status === '待清理'" class="link" type="button" @click="schedule(row)">
              安排清理
            </button>
            <button class="link primary-link" type="button" @click="confirm(row)">确认完成</button>
            <button class="link danger-link" type="button" @click="damage(row)">登记损坏</button>
          </td>
        </tr>
        <tr v-if="!queue.length">
          <td colspan="7" class="empty-state">待清理队列已清空，所有在役栅体压差均在阈值以内</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">另存的清污清单（历史清污记录，按清理日期倒序）</h3>
    <p class="stock-note">
      早于平台上线（2026-09-01）的清污按清理日期回填，来源标注「存量补录」；
      清理日期缺失的不虚构记录，以备注说明待查。
    </p>
    <table class="data-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>清理日期</th>
          <th>清污方式</th>
          <th>清理人员</th>
          <th>清前压差</th>
          <th>清后压差</th>
          <th>来源</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in logs" :key="item.id" :class="{ 'row-muted': item.来源 === '存量补录' }">
          <td>{{ item.id }}</td>
          <td>{{ item.栅体编号 }}</td>
          <td>{{ item.所属机组 }}</td>
          <td>{{ item.清理日期 || '日期缺失' }}</td>
          <td>{{ item.清污方式 || '—' }}</td>
          <td>{{ item.清理人员 || '—' }}</td>
          <td>{{ item.清前压差.toFixed(2) }}m</td>
          <td>{{ item.清后压差.toFixed(2) }}m</td>
          <td><span class="tag" :class="item.来源 === '存量补录' ? 'tag-stock' : 'tag-live'">{{ item.来源 }}</span></td>
          <td class="muted-cell">{{ item.备注 || '—' }}</td>
        </tr>
        <tr v-if="!logs.length">
          <td colspan="10" class="empty-state">暂无清污记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>压差超限阈值 {{ limit }}m · 清污完成后残余压差按 {{ residual }}m 计，全平台同一口径</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadCsv,
  exportCleaningLogs,
  listCleaningLogs,
  listCleaningQueue,
  runAction as applyAction,
  trashrackSummary,
} from '@/api/local-service'
import { overLimit, PRESSURE_LIMIT, RESIDUAL_PRESSURE, toPressure } from '@/domain/trashrack'
import { useSessionStore } from '@/stores/session'
import type { CleaningLog, EntryRow } from '@/data/types'

const router = useRouter()
const session = useSessionStore()
const limit = PRESSURE_LIMIT.toFixed(2)
const residual = RESIDUAL_PRESSURE.toFixed(2)

const queue = ref<EntryRow[]>([])
const logs = ref<CleaningLog[]>([])
const errorMessage = ref('')

const overCount = computed(() => queue.value.filter((row) => overLimit(row)).length)
// 已清理台数以栅体清单为准（与列表页、概览同口径），不按日志去重。
const cleanedCount = computed(() => trashrackSummary().cleaned)

function isOver(row: EntryRow): boolean {
  return overLimit(row)
}

function formatPressure(value: string | number | boolean): string {
  return `${toPressure(value).toFixed(2)}m`
}

function act(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('trashrack', Number(row.id), action, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function schedule(row: EntryRow) {
  act('安排清理', row)
}

function confirm(row: EntryRow) {
  act('确认完成', row)
}

function damage(row: EntryRow) {
  act('登记损坏', row)
}

function exportLogs() {
  const { filename, content } = exportCleaningLogs()
  downloadCsv(filename, content)
}

function goBack() {
  router.push('/trashrack')
}

function reload() {
  try {
    queue.value = listCleaningQueue()
    logs.value = listCleaningLogs()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清污次序读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  font-size: 15px;
  margin: 18px 0 8px;
}
.stock-note {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.stat-warn {
  color: #b45418;
}
.tone-danger .stat-value,
.danger-text {
  color: #b42318;
  font-weight: 600;
}
.danger-link {
  color: #b42318;
}
.primary-link {
  font-weight: 600;
}
.tag {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
}
.tag-stock {
  background: #f1ebdd;
  color: #8a6116;
}
.tag-live {
  background: #e6f0ff;
  color: #1f6feb;
}
.row-muted {
  background: #faf8f3;
}
.muted-cell {
  color: var(--muted);
}
small {
  font-size: 12px;
}
</style>

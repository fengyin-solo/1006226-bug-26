<template>
  <section class="page" data-module="trashrack">
    <header class="page-head">
      <div>
        <h2>拦污栅管理</h2>
        <p class="page-desc">维护拦污栅，围绕栅体编号、所属机组、前后压差、清污次数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="goCleaning">进入清污次序</button>
        <button class="btn" type="button" @click="exportRows">导出拦污栅清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="item.tone">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}<small v-if="item.suffix">{{ item.suffix }}</small></strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <td v-for="column in columns" :key="column">
            <span v-if="column === '前后压差'" :class="{ 'danger-text': isOver(row) }">
              {{ formatPressure(row[column]) }}<small v-if="isOver(row)"> 超限</small>
            </span>
            <span v-else-if="column === '清理日期'">{{ row[column] || '—' }}</span>
            <span v-else>{{ row[column] ?? '—' }}</span>
          </td>
          <td :class="{ 'danger-text': isOver(row) }">{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无拦污栅数据，可先登记拦污栅</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条拦污栅记录 · 压差超限阈值 {{ limit }}m，确认完成后压差与清污次序统一重算</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  trashrackSummary,
} from '@/api/local-service'
import { overLimit, PRESSURE_LIMIT, toPressure } from '@/domain/trashrack'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const session = useSessionStore()
const meta = moduleMeta('trashrack')
const columns = ["栅体编号", "所属机组", "前后压差", "清污次数", "清污方式", "清理日期", "清理人员", "栅体状态"]
const statuses = ["待清理", "清理中", "已清理", "已损坏"]
const limit = PRESSURE_LIMIT.toFixed(2)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => {
  const summary = trashrackSummary()
  return [
    { label: '待清理栅体', value: summary.pending },
    { label: '已清理栅体', value: summary.cleaned },
    { label: '压差超限', value: summary.overLimitCount, tone: summary.overLimitCount ? 'tone-danger' : '' },
    { label: '已损坏', value: summary.damaged },
    { label: '当前最大压差', value: summary.maxPressure.toFixed(2), suffix: 'm' },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOver(row: EntryRow): boolean {
  return overLimit(row)
}

function formatPressure(value: string | number | boolean): string {
  return `${toPressure(value).toFixed(2)}m`
}

// 只给当前状态允许的动作按钮，已清理的不再出现「确认完成」，从入口上挡住重复确认。
function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待清理') {
    return ['安排清理', '确认完成', '登记损坏']
  }
  if (status === '清理中') {
    return ['确认完成', '登记损坏']
  }
  if (status === '已清理') {
    return []
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function goCleaning() {
  router.push('/trashrack/cleaning')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  if (!result.ok) {
    // 失败（含落库失败回滚、重复确认拦截）后强制重读，页面不留上一次的半截状态。
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '拦污栅列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tone-danger .stat-value {
  color: #b42318;
}
.danger-text {
  color: #b42318;
  font-weight: 600;
}
.stat-value small {
  font-size: 12px;
  font-weight: 400;
  margin-left: 2px;
}
</style>

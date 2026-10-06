<template>
  <section class="page" data-module="protection">
    <header class="page-head">
      <div>
        <h2>继电保护管理</h2>
        <p class="page-desc">设备状态以运行台账最新受理校验结论为准；重复报送直接退回、仅作留痕。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="goLedger">查看运行台账</button>
        <button class="btn" type="button" @click="exportRows">导出继电保护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="item.tone">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
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
            <span v-if="column === '下次校验日'" :class="{ 'danger-text': isDue(row) }">
              {{ row[column] || '—' }}<small v-if="isDue(row)"> 到期/临近</small>
            </span>
            <span v-else>{{ row[column] ?? '—' }}</span>
          </td>
          <td :class="{ 'danger-text': row.status === '异常' }">{{ row.status }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无继电保护数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 台在账保护装置 · 状态以运行台账受理结论为准，汇总条与台账同步</span>
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
  protectionSummary,
  runAction as applyAction,
} from '@/api/local-service'
import { daysBetween, today } from '@/data/clock'
import { DUE_SOON_DAYS } from '@/domain/protection'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const session = useSessionStore()
const meta = moduleMeta('protection')
const columns = ["装置编号", "保护类型", "定值单号", "上次校验日", "下次校验日", "动作次数", "校验人员", "装置状态"]
const statuses = ["待校验", "正常", "异常", "已退出"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => {
  const summary = protectionSummary()
  return [
    { label: '在账保护装置', value: summary.inLedger },
    { label: '正常装置', value: summary.normal },
    { label: '待校验装置', value: summary.pendingCalibration },
    {
      label: `${DUE_SOON_DAYS}天内到期`,
      value: summary.dueSoon,
      tone: summary.dueSoon ? 'tone-warn' : '',
    },
    { label: '异常装置', value: summary.abnormal, tone: summary.abnormal ? 'tone-danger' : '' },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isDue(row: EntryRow): boolean {
  const days = daysBetween(today(), String(row['下次校验日'] ?? ''))
  return Number.isFinite(days) && days <= DUE_SOON_DAYS
}

// 已退出的装置不再报送结论；提交校验/标记异常都进运行台账。
function availableActions(row: EntryRow): string[] {
  if (String(row.status) === '已退出') {
    return []
  }
  return ['提交校验', '标记异常', '退出运行']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function goLedger() {
  router.push('/protection/ledger')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  if (!result.ok) {
    // 重复报送退回或落库失败回滚后强制重读，页面与台账保持同一份结论。
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继电保护列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tone-danger {
  color: #b42318;
}
.tone-warn .stat-value {
  color: #b45418;
}
.danger-text {
  color: #b42318;
  font-weight: 600;
}
small {
  font-size: 12px;
}
</style>

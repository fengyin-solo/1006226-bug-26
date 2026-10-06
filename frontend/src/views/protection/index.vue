<template>
  <section class="page" data-module="protection">
    <header class="page-head">
      <div>
        <h2>继电保护管理</h2>
        <p class="page-desc">
          装置校验结论先落跨模块运行台账（权威口径），装置状态仅作留痕；同一份结论重复报送直接退回。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="exportRows">导出继电保护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in summaryCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ alarm: item.alarm }">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- 装置列表 -->
    <div v-if="activeTab === 'list'">
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
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '待校验'"
                class="link"
                type="button"
                @click="openCheck(row)"
              >
                提交校验
              </button>
              <button
                v-if="String(row.status) === '正常'"
                class="link link-danger"
                type="button"
                @click="runGeneric('标记异常', row)"
              >
                标记异常
              </button>
              <button
                v-if="String(row.status) !== '已退出' && String(row.status) !== '待校验'"
                class="link link-danger"
                type="button"
                @click="runGeneric('退出运行', row)"
              >
                退出运行
              </button>
              <span v-if="String(row.status) === '待校验'" class="muted-text">待校验入账</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无继电保护数据，可先登记保护装置</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 运行台账（与拦污栅共用同一份跨模块流水） -->
    <div v-if="activeTab === 'ledger'">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">校验台账条数（权威口径）</span>
          <strong class="stat-value">{{ checkCalibers.ledger }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">装置状态为正常（留痕口径）</span>
          <strong class="stat-value">{{ checkCalibers.trace }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">两口径校验结论一致性</span>
          <strong class="stat-value" :class="checkCalibers.consistent ? 'ok' : 'alarm'">
            {{ checkCalibers.consistent ? '一致' : '不一致' }}
          </strong>
        </article>
      </div>
      <p class="page-desc cross-line">
        跨模块同口径：运行台账中清污结论 {{ cleaningLedgerCount }} 条，与拦污栅模块清污记录 {{ cleaningTrace }} 条
        <span :class="cleaningConsistent ? 'ok' : 'alarm'">
          {{ cleaningConsistent ? '完全一致' : '不一致' }}
        </span>。
      </p>

      <section v-if="gapNoteList.length" class="note-panel">
        <h3>早年缺项说明</h3>
        <p v-for="note in gapNoteList" :key="note.id" class="gap-note">{{ note.occurredAt }} · {{ note.note }}</p>
      </section>

      <table class="data-table">
        <thead>
          <tr>
            <th>校验日期</th><th>装置编号</th><th>保护类型</th><th>校验结论</th>
            <th>校验人员</th><th>落账时间</th><th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in checkLedger" :key="item.id">
            <td>{{ item.occurredAt }}</td>
            <td>{{ item.entityRef }}</td>
            <td>{{ item.payload.protectionType ?? '—' }}</td>
            <td>{{ item.payload.checkResult ?? '—' }}</td>
            <td>{{ item.recordedBy }}</td>
            <td>{{ formatTime(item.recordedAt) }}</td>
            <td>
              <span v-if="item.backfilled" class="tag tag-backfill">补录</span>
              <span v-else class="tag tag-ok">平台记录</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 提交校验弹窗 -->
    <div v-if="checkTarget" class="modal-mask" @click.self="closeCheck">
      <form class="modal" @submit.prevent="submitCheck">
        <h3>提交校验 · {{ checkTarget['装置编号'] }}</h3>
        <p class="page-desc">校验结论与装置状态同一事务写入运行台账，重复报送直接退回。</p>
        <label class="filter-item">
          <span>校验日期</span>
          <input v-model="checkForm.checkDate" type="date" required />
        </label>
        <label class="filter-item">
          <span>校验结论</span>
          <select v-model="checkForm.result">
            <option>合格</option>
            <option>不合格</option>
          </select>
        </label>
        <label class="filter-item">
          <span>校验人员</span>
          <input v-model="checkForm.checker" required />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCheck">取消</button>
          <button class="btn primary" type="submit">提交并入台账</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 台保护装置 · 待校验 {{ pendingCount }} 台</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  cleaningLedgerCount,
  compareCalibers,
  gapNotes,
  ledgerByModule,
  protectionCheckCount,
} from '@/domain/ledger'
import { cleaningRecords } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const meta = moduleMeta('protection')
const columns = ['装置编号', '保护类型', '定值单号', '上次校验日', '下次校验日', '动作次数', '校验人员', '装置状态']
const statuses = ['待校验', '正常', '异常', '已退出']
const tabs = [
  { key: 'list', label: '装置列表' },
  { key: 'ledger', label: '运行台账' },
] as const

const activeTab = ref<'list' | 'ledger'>('list')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['装置编号', '保护类型', '定值单号']
const checkTarget = ref<EntryRow | null>(null)
const checkForm = reactive({ checkDate: today(), result: '合格', checker: session.operator })

const pendingCount = computed(() => rows.value.filter((row) => String(row.status) === '待校验').length)
const abnormalCount = computed(() => rows.value.filter((row) => row.abnormal).length)
const normalCount = computed(() => rows.value.filter((row) => String(row.status) === '正常').length)
const dueSoonCount = computed(() =>
  rows.value.filter((row) => {
    const nextDate = String(row['下次校验日'] ?? '')
    return String(row.status) === '正常' && nextDate !== '' && nextDate <= '2026-10-06'
  }).length,
)
const summaryCards = computed(() => [
  { label: '正常保护装置', value: normalCount.value, alarm: false },
  { label: '待校验装置', value: pendingCount.value, alarm: pendingCount.value > 0 },
  { label: '校验到期/异常', value: dueSoonCount.value + abnormalCount.value, alarm: dueSoonCount.value + abnormalCount.value > 0 },
  { label: '校验台账条数', value: protectionCheckCount(), alarm: false },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const checkLedger = computed(() => ledgerByModule('protection'))
const gapNoteList = computed(() => gapNotes('protection'))
// 权威口径：台账里最新一次校验结论为「合格」的装置数；留痕口径：装置表状态为「正常」数。
const ledgerPassedDevices = computed(() => {
  const latest = new Map<string, string>()
  for (const item of checkLedger.value) {
    const result = String(item.payload.checkResult ?? '')
    const prev = latest.get(item.entityRef)
    if (!prev || item.occurredAt >= prev) latest.set(item.entityRef, result)
  }
  return [...latest.values()].filter((result) => result === '合格').length
})
const checkCalibers = computed(() => compareCalibers(ledgerPassedDevices.value, normalCount.value))
const cleaningTrace = computed(() => cleaningRecords().length)
const cleaningConsistent = computed(() => cleaningLedgerCount() === cleaningTrace.value)

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function runGeneric(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
}

function openCheck(row: EntryRow) {
  errorMessage.value = ''
  checkTarget.value = row
  checkForm.checkDate = today()
  checkForm.result = '合格'
  checkForm.checker = session.operator
}

function closeCheck() {
  checkTarget.value = null
  errorMessage.value = ''
}

function submitCheck() {
  if (!checkTarget.value) return
  const result = applyAction(meta.key, Number(checkTarget.value.id), '提交校验', { ...checkForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  closeCheck()
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
.alarm { color: #b42318; }
.ok { color: #067647; }
.muted-text { color: var(--muted); font-size: 12px; }
.link-danger { color: #b42318; }
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-item {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab-item.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; }
.tag-ok { background: #d1fadf; color: #067647; }
.tag-backfill { background: #fef0c7; color: #b54708; }
.note-panel {
  margin: 0 0 12px;
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.note-panel h3 { margin: 0 0 4px; font-size: 14px; }
.cross-line { margin: 0 0 12px; padding: 8px 12px; background: #eef2f7; border-radius: 6px; }
.gap-note { margin: 4px 0; font-size: 12px; color: #b54708; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal h3 { margin: 0; font-size: 15px; }
.modal select, .modal input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>

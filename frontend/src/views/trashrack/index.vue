<template>
  <section class="page" data-module="trashrack">
    <header class="page-head">
      <div>
        <h2>拦污栅管理</h2>
        <p class="page-desc">
          栅体列表、清污次序与清污记录共用同一份口径：确认完成时重算压差与优先次序，已清理栅体即时移出待清理名单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记拦污栅</button>
        <button class="btn" type="button" @click="exportRows">导出拦污栅清单</button>
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
        <span v-if="tab.key === 'queue'" class="tab-badge">{{ queue.length }}</span>
      </button>
    </nav>

    <!-- 栅体列表 -->
    <div v-if="activeTab === 'list'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
        <span class="legend-item legend-alarm">压差超限：{{ summary.overLimitCount }}</span>
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
              <template v-if="column === '前后压差'">
                {{ pressureOf(row).toFixed(1) }} m
                <span v-if="isOverLimit(row)" class="tag tag-alarm">超限</span>
              </template>
              <template v-else-if="column === '静态压差'">{{ row[column] === '' || row[column] == null ? '—' : `${Number(row[column]).toFixed(1)} m` }}</template>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '待清理'"
                class="link"
                type="button"
                @click="runGeneric('安排清理', row)"
              >
                安排清理
              </button>
              <button
                v-if="String(row.status) === '清理中'"
                class="link"
                type="button"
                @click="openConfirm(row)"
              >
                确认完成
              </button>
              <button
                v-if="String(row.status) !== '已损坏' && String(row.status) !== '已清理'"
                class="link link-danger"
                type="button"
                @click="runGeneric('登记损坏', row)"
              >
                登记损坏
              </button>
              <span v-if="String(row.status) === '已清理'" class="muted-text">已完成</span>
              <span v-else-if="String(row.status) === '已损坏'" class="muted-text">停用待换</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无拦污栅数据，可先登记拦污栅</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 清污次序 -->
    <div v-if="activeTab === 'queue'">
      <div class="queue-head">
        <p class="page-desc">
          待清理名单按压差从大到小排序（阈值 {{ PRESSURE_LIMIT }} m），确认完成、压差回落后自动重排并移出名单。
        </p>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="saveSnapshot">另存清污清单</button>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>优先次序</th><th>栅体编号</th><th>所属机组</th><th>前后压差</th>
            <th>清污次数</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in queue" :key="String(row.id)">
            <td><strong>{{ index + 1 }}</strong></td>
            <td>{{ row['栅体编号'] }}</td>
            <td>{{ row['所属机组'] }}</td>
            <td>
              <strong :class="{ alarm: isOverLimit(row) }">{{ pressureOf(row).toFixed(1) }} m</strong>
              <span v-if="isOverLimit(row)" class="tag tag-alarm">超限</span>
            </td>
            <td>{{ row['清污次数'] }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '待清理'"
                class="link"
                type="button"
                @click="runGeneric('安排清理', row)"
              >
                安排清理
              </button>
              <button
                v-if="String(row.status) === '清理中'"
                class="link"
                type="button"
                @click="openConfirm(row)"
              >
                确认完成
              </button>
            </td>
          </tr>
          <tr v-if="!queue.length">
            <td colspan="7" class="empty-state">待清理名单为空，所有栅体压差正常</td>
          </tr>
        </tbody>
      </table>

      <section v-if="saved" class="snapshot-panel">
        <header class="snapshot-head">
          <h3>另存的清污清单</h3>
          <span class="muted-text">另存于 {{ formatTime(saved.savedAt) }}（仅作留痕，数据以当前同源名单为准）</span>
          <button class="btn ghost" type="button" @click="discardSnapshot">丢弃留痕</button>
        </header>
        <table class="data-table">
          <thead>
            <tr><th>栅体编号</th><th>另存次序</th><th>另存压差</th><th>当前次序</th><th>当前压差</th><th>变化</th></tr>
          </thead>
          <tbody>
            <tr v-for="diff in snapshotDiff" :key="diff.code">
              <td>{{ diff.code }} <span class="muted-text">{{ diff.unit }}</span></td>
              <td>{{ diff.savedRank }}</td>
              <td>{{ diff.savedPressure.toFixed(1) }} m</td>
              <td>{{ diff.currentRank ?? '—' }}</td>
              <td>{{ diff.currentPressure === null ? '—' : `${diff.currentPressure.toFixed(1)} m` }}</td>
              <td>
                <span v-if="diff.removed" class="tag tag-ok">已清理移出名单</span>
                <span v-else-if="diff.savedRank !== (diff.currentRank ?? -1)" class="tag tag-shift">次序已重排</span>
                <span v-else-if="Math.abs(diff.savedPressure - (diff.currentPressure ?? diff.savedPressure)) > 0.001" class="tag tag-shift">压差已重算</span>
                <span v-else class="muted-text">无变化</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 清污记录 -->
    <div v-if="activeTab === 'history'">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">台账清污次数（权威口径）</span>
          <strong class="stat-value">{{ calibers.ledger }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">栅体清污次数合计（留痕口径）</span>
          <strong class="stat-value">{{ calibers.trace }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">口径一致性</span>
          <strong class="stat-value" :class="calibers.consistent ? 'ok' : 'alarm'">
            {{ calibers.consistent ? '一致' : '不一致' }}
          </strong>
        </article>
      </div>

      <section v-if="gapNotes.length" class="note-panel">
        <h3>早年缺项说明</h3>
        <p v-for="note in gapNotes" :key="note.id" class="gap-note">{{ note.occurredAt }} · {{ note.note }}</p>
      </section>

      <table class="data-table">
        <thead>
          <tr>
            <th>清理日期</th><th>栅体编号</th><th>所属机组</th><th>清污方式</th>
            <th>清理人员</th><th>清理前压差</th><th>清理后压差</th><th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in sortedRecords" :key="record.id">
            <td>{{ record.cleanDate }}</td>
            <td>{{ record.rackCode }}</td>
            <td>{{ record.unit }}</td>
            <td>{{ record.method }}</td>
            <td>{{ record.operator }}</td>
            <td>{{ record.pressureBefore.toFixed(1) }} m</td>
            <td>{{ record.pressureAfter.toFixed(1) }} m</td>
            <td>
              <span v-if="record.backfilled" class="tag tag-backfill">补录</span>
              <span v-else class="tag tag-ok">平台记录</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 确认完成弹窗 -->
    <div v-if="confirmTarget" class="modal-mask" @click.self="closeConfirm">
      <form class="modal" @submit.prevent="submitConfirm">
        <h3>确认完成清污 · {{ confirmTarget['栅体编号'] }}</h3>
        <p class="page-desc">
          所属机组 {{ confirmTarget['所属机组'] }}，清理前压差 {{ pressureOf(confirmTarget).toFixed(1) }} m。
          提交后压差按静态压差重算、栅体移出待清理名单，清污次数 +1。
        </p>
        <label class="filter-item">
          <span>清理日期</span>
          <input v-model="confirmForm.cleanDate" type="date" required />
        </label>
        <label class="filter-item">
          <span>清污方式</span>
          <select v-model="confirmForm.method">
            <option>机械清污</option>
            <option>人工清污</option>
          </select>
        </label>
        <label class="filter-item">
          <span>清理人员</span>
          <input v-model="confirmForm.operator" required />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeConfirm">取消</button>
          <button class="btn primary" type="submit">确认完成</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条拦污栅记录 · 待清理 {{ queue.length }} 台</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { cleaningRecords } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import {
  PRESSURE_LIMIT,
  cleaningQueue,
  compareRackCalibers,
  rackGapNotes,
  isOverLimit,
  pressureOf,
  summarizeTrashrack,
} from '@/domain/trashrack'
import {
  clearSavedCleaningList,
  diffSnapshot,
  loadSavedCleaningList,
  saveCleaningList,
  type SavedCleaningSnapshot,
} from '@/domain/cleaning-list'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const meta = moduleMeta('trashrack')
const columns = ['栅体编号', '所属机组', '前后压差', '静态压差', '清污次数', '清污方式', '清理日期', '清理人员', '栅体状态']
const statuses = ['待清理', '清理中', '已清理', '已损坏']
const tabs = [
  { key: 'list', label: '栅体列表' },
  { key: 'queue', label: '清污次序' },
  { key: 'history', label: '清污记录' },
] as const

const activeTab = ref<'list' | 'queue' | 'history'>('list')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['栅体编号', '所属机组', '前后压差']

const queue = ref<EntryRow[]>([])
const saved = ref<SavedCleaningSnapshot | null>(null)
const confirmTarget = ref<EntryRow | null>(null)
const confirmForm = reactive({ cleanDate: today(), method: '机械清污', operator: session.operator })

const summary = computed(() => summarizeTrashrack(rows.value))
const summaryCards = computed(() => [
  { label: '待清理栅体', value: summary.value.pendingCount, alarm: false },
  { label: '已清理栅体', value: summary.value.cleanedCount, alarm: false },
  { label: '压差超限', value: summary.value.overLimitCount, alarm: summary.value.overLimitCount > 0 },
  { label: '最大压差(m)', value: summary.value.maxPressure.toFixed(1), alarm: summary.value.maxPressure >= PRESSURE_LIMIT },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const sortedRecords = computed(() =>
  [...cleaningRecords()].sort((a, b) => b.cleanDate.localeCompare(a.cleanDate)),
)
const calibers = computed(() =>
  compareRackCalibers(rows.value, cleaningRecords()),
)
const gapNotes = computed(() => rackGapNotes())
const snapshotDiff = computed(() => (saved.value ? diffSnapshot(saved.value) : []))

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '拦污栅登记入口尚未接入审批流'
}

function runGeneric(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openConfirm(row: EntryRow) {
  errorMessage.value = ''
  confirmTarget.value = row
  confirmForm.cleanDate = today()
  confirmForm.method = '机械清污'
  confirmForm.operator = session.operator
}

function closeConfirm() {
  confirmTarget.value = null
  errorMessage.value = ''
}

function submitConfirm() {
  if (!confirmTarget.value) return
  const result = applyAction(meta.key, Number(confirmTarget.value.id), '确认完成', { ...confirmForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  closeConfirm()
  reload()
}

function saveSnapshot() {
  saved.value = saveCleaningList()
}

function discardSnapshot() {
  clearSavedCleaningList()
  saved.value = null
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    queue.value = cleaningQueue(rows.value)
    saved.value = loadSavedCleaningList()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '拦污栅列表读取失败'
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
.tab-badge {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  margin-left: 4px;
  border-radius: 999px;
  background: #fee4e2;
  color: #b42318;
  font-size: 11px;
  line-height: 16px;
}
.tab-item.active .tab-badge { background: rgba(255, 255, 255, 0.25); color: #fff; }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
.tag-alarm { background: #fee4e2; color: #b42318; }
.tag-ok { background: #d1fadf; color: #067647; }
.tag-backfill { background: #fef0c7; color: #b54708; }
.tag-shift { background: #e0eaff; color: #1d4ed8; }
.queue-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.snapshot-panel, .note-panel {
  margin-top: 14px;
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.snapshot-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.snapshot-head h3, .note-panel h3 { margin: 0; font-size: 14px; }
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

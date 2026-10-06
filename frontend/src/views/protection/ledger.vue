<template>
  <section class="page" data-module="protection-ledger">
    <header class="page-head">
      <div>
        <h2>继电保护运行台账</h2>
        <p class="page-desc">
          每台装置的当前结论以最新一条「受理」校验记录为准，更早的结论与退回件仅作留痕。
          存量台账按记录时间回填，上线前缺项的另登记「缺项说明」，不虚构校验记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="exportLedger">导出台账</button>
        <button class="btn" type="button" @click="goBack">返回装置列表</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账记录总数</span>
        <strong class="stat-value">{{ ledger.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">受理结论（有效）</span>
        <strong class="stat-value">{{ acceptedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">退回件（重复报送，仅留痕）</span>
        <strong class="stat-value" :class="{ 'stat-warn': rejectedCount > 0 }">{{ rejectedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">缺项说明</span>
        <strong class="stat-value">{{ missingCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>装置编号</th>
          <th>保护类型</th>
          <th>记录时间</th>
          <th>校验结论</th>
          <th>动作次数</th>
          <th>校验人员</th>
          <th>接收状态</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in ledger"
          :key="item.id"
          :class="{
            'row-rejected': item.接收状态 === '退回',
            'row-missing': item.接收状态 === '缺项说明',
          }"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.装置编号 }}</td>
          <td>{{ item.保护类型 }}</td>
          <td>{{ item.记录时间 || '时间缺失' }}</td>
          <td>
            <strong v-if="item.接收状态 === '受理'">{{ item.校验结论 }}</strong>
            <span v-else class="muted-text">—</span>
          </td>
          <td>{{ item.动作次数 }}</td>
          <td>{{ item.校验人员 || '—' }}</td>
          <td>
            <span class="tag" :class="tagClass(item.接收状态)">{{ item.接收状态 }}</span>
          </td>
          <td class="muted-text">{{ item.备注 || '—' }}</td>
        </tr>
        <tr v-if="!ledger.length">
          <td colspan="9" class="empty-state">运行台账暂无记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        跨模块对账：运行台账涉及装置 {{ deviceCountInLedger }} 台 · 设备台账在账
        {{ summary.inLedger }} 台 · 运营概览「继电保护」登记 {{ overviewCount }} 台，
        <strong :class="reconciled ? 'ok-text' : 'error-text'">
          {{ reconciled ? '三处台数一致' : '台数不一致，请检查' }}
        </strong>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadCsv,
  exportProtectionLedger,
  listEntries,
  listProtectionLedger,
  loadOverview,
  protectionSummary,
} from '@/api/local-service'
import type { ProtectionLedgerEntry } from '@/data/types'

const router = useRouter()

const ledger = ref<ProtectionLedgerEntry[]>([])
const errorMessage = ref('')

const acceptedCount = computed(() => ledger.value.filter((item) => item.接收状态 === '受理').length)
const rejectedCount = computed(() => ledger.value.filter((item) => item.接收状态 === '退回').length)
const missingCount = computed(() => ledger.value.filter((item) => item.接收状态 === '缺项说明').length)
// 台账覆盖的装置（含缺项说明的装置），与设备台账逐台对账。
const deviceCountInLedger = computed(
  () => new Set(ledger.value.map((item) => item.装置编号)).size,
)
const summary = computed(() => protectionSummary())
const overviewCount = computed(() => {
  const row = loadOverview().modules.find((item) => item.name === '继电保护')
  return row?.created ?? 0
})
const reconciled = computed(
  () =>
    deviceCountInLedger.value === summary.value.inLedger &&
    summary.value.inLedger === overviewCount.value,
)

function tagClass(status: ProtectionLedgerEntry['接收状态']): string {
  if (status === '受理') {
    return 'tag-accepted'
  }
  if (status === '退回') {
    return 'tag-rejected'
  }
  return 'tag-missing'
}

function exportLedger() {
  const { filename, content } = exportProtectionLedger()
  downloadCsv(filename, content)
}

function goBack() {
  router.push('/protection')
}

function reload() {
  errorMessage.value = ''
  try {
    ledger.value = listProtectionLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运行台账读取失败'
  }
}

onMounted(() => {
  // 触发一次装置列表读取，保证设备台账同样按当天口径归一化。
  listEntries('protection')
  reload()
})
</script>

<style scoped>
.tag {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
}
.tag-accepted {
  background: #e7f6ec;
  color: #1a7f37;
}
.tag-rejected {
  background: #fdecec;
  color: #b42318;
}
.tag-missing {
  background: #f1ebdd;
  color: #8a6116;
}
.row-rejected {
  background: #fdf6f6;
}
.row-missing {
  background: #faf8f3;
}
.muted-text {
  color: var(--muted);
}
.stat-warn {
  color: #b45418;
}
.ok-text {
  color: #1a7f37;
}
.error-text {
  color: #b42318;
}
</style>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value" :class="{ alarm: card.alarm }">{{ card.value }}</strong>
      </article>
    </div>
    <section class="focus-bar">
      <span class="focus-title">拦污栅压差监测</span>
      <span>待清理 {{ rackSummary.pendingCount }} 台</span>
      <span :class="{ alarm: rackSummary.overLimitCount > 0 }">压差超限 {{ rackSummary.overLimitCount }} 台</span>
      <span>已清理 {{ rackSummary.cleanedCount }} 台</span>
      <span>最大压差 {{ rackSummary.maxPressure.toFixed(1) }} m</span>
      <span class="muted-text">与栅体列表、清污次序同源，确认清污后即时刷新</span>
    </section>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { summarizeTrashrack, type TrashrackSummary } from '@/domain/trashrack'
import type { OverviewResult } from '@/data/types'

type AlarmCard = OverviewResult['cards'][number] & { alarm?: boolean }

const cards = ref<AlarmCard[]>([])
const moduleRows = ref<OverviewResult['modules']>([])
const rackSummary = ref<TrashrackSummary>({
  pendingCount: 0,
  cleanedCount: 0,
  damagedCount: 0,
  overLimitCount: 0,
  maxPressure: 0,
  cleaningTotal: 0,
})

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards.map((card) => ({
    ...card,
    alarm: card.label === '压差超限栅体' && card.value > 0,
  }))
  moduleRows.value = payload.modules
  rackSummary.value = summarizeTrashrack(listRows('trashrack'))
}

onMounted(refresh)
</script>

<style scoped>
.focus-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}
.focus-title { font-weight: 600; }
.alarm { color: #b42318; font-weight: 600; }
.muted-text { color: var(--muted); font-size: 12px; }
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSearchStore } from '../stores/searchStore'
import type { FieldMatch, HighlightPart } from '../types/search'
import HighlightParts from '../components/common/HighlightParts.vue'
import VacantHint from '../components/common/VacantHint.vue'

const searchStore = useSearchStore()
const inputRef = ref<{ focus: () => void }>()

const status = computed(() => searchStore.status)
const snapshot = computed(() => searchStore.snapshot)

const progressPercent = computed(() => {
  const { done, total } = status.value
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
})

const building = computed(() => status.value.phase === 'building' && !status.value.paused)
const paused = computed(() => status.value.phase === 'building' && status.value.paused)

function fieldParts(fields: FieldMatch[], label: string): HighlightPart[] | null {
  return fields.find((field) => field.label === label)?.parts ?? null
}

function extraFields(fields: FieldMatch[], excluded: string[]): FieldMatch[] {
  return fields.filter((field) => !excluded.includes(field.label))
}

function focusInput(): void {
  inputRef.value?.focus()
}

onMounted(() => {
  void searchStore.ensureIndex()
})
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">LOCAL INDEX SEARCH</span>
        <h1>本地检索台</h1>
        <p>
          沿图幅号、古名、新名、异写、沿革与扫描件名建立本地倒排索引，命中后回到
          「图幅 → 扫描件 → 地名 → 沿革」关联链。索引分批构建、断点续做，数据变化只重算受影响条目。
        </p>
      </div>
    </div>

    <div class="panel index-status" data-testid="search-status">
      <div class="panel__header">
        <h2>索引状态</h2>
        <div class="index-status__actions">
          <el-button v-if="building" size="small" data-testid="cancel-build" @click="searchStore.cancelIndexBuild()">
            取消（保留检查点）
          </el-button>
          <el-button
            v-if="paused"
            size="small"
            type="primary"
            data-testid="resume-build"
            @click="searchStore.ensureIndex()"
          >
            从检查点续建
          </el-button>
          <el-button
            size="small"
            plain
            :disabled="building"
            data-testid="rebuild-index"
            @click="searchStore.rebuildIndex()"
          >
            整库重建
          </el-button>
        </div>
      </div>
      <div class="panel__body">
        <template v-if="status.phase === 'building'">
          <div class="index-status__line">
            <el-tag v-if="building" type="warning" effect="dark">分批重建中</el-tag>
            <el-tag v-else type="info" effect="dark">已暂停，等待续建</el-tag>
            <span>
              当前批次：{{ status.tableLabel }} · 已完成
              <strong data-testid="build-done">{{ status.done }}</strong> / {{ status.total }} 条
            </span>
          </div>
          <el-progress :percentage="progressPercent" :stroke-width="10" />
          <p v-if="status.error" class="text-danger">上次中断原因：{{ status.error }}</p>
          <p class="index-status__note">
            失败或取消都会留下检查点，续建从检查点继续且不添重复条目；重建期间检索结果保留上一份完整快照。
          </p>
        </template>
        <template v-else>
          <div class="index-status__line">
            <el-tag type="success" effect="dark">索引就绪</el-tag>
            <span>
              第 <strong data-testid="index-generation">{{ status.generation }}</strong> 代 · 共
              <strong data-testid="index-doc-count">{{ status.docCount }}</strong> 条文档
            </span>
          </div>
          <p class="index-status__note">新增或修改条目时只增量重算对应文档，此代数随每批提交递增。</p>
        </template>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="searchStore.keyword"
        clearable
        class="filter-bar__grow"
        placeholder="输入图幅号、古名、新名、异写、沿革或扫描件名"
        data-testid="search-input"
        ref="inputRef"
      />
      <span class="filter-count">
        命中条目：<strong data-testid="count-hits">{{ snapshot?.totalHits ?? 0 }}</strong>
      </span>
    </div>

    <el-alert
      v-if="searchStore.updating && snapshot"
      type="warning"
      :closable="false"
      class="updating-banner"
      data-testid="updating-banner"
    >
      <template #title>
        索引更新中——以下为第 {{ snapshot.generation }} 代完整结果，新结果算完后整份替换，不会混入新旧条目。
      </template>
    </el-alert>

    <template v-if="snapshot && snapshot.groups.length">
      <p v-if="snapshot.truncated" class="muted">命中过多，仅展示排名靠前的分组，请补充关键词缩小范围。</p>
      <div class="chain-list">
        <article v-for="group in snapshot.groups" :key="group.sheet.id" class="chain-group" data-testid="group-chain">
          <header class="chain-group__head">
            <el-tag :type="group.sheet.matched ? 'danger' : 'info'" effect="plain" size="small">
              {{ group.sheet.matched ? '图幅命中' : '关联图幅' }}
            </el-tag>
            <router-link :to="`/sheets/${group.sheet.id}`" class="chain-group__code">
              <HighlightParts v-if="fieldParts(group.sheet.fields, '图幅号')" :parts="fieldParts(group.sheet.fields, '图幅号')!" />
              <template v-else>{{ group.sheet.code }}</template>
            </router-link>
            <span class="chain-group__title">
              <HighlightParts v-if="fieldParts(group.sheet.fields, '题名')" :parts="fieldParts(group.sheet.fields, '题名')!" />
              <template v-else>{{ group.sheet.title }}</template>
            </span>
            <span class="chain-group__meta">
              {{ group.sheet.year }} 年 · 扫描件 {{ group.scanCount }} · 地名 {{ group.pairCount }}
            </span>
            <span class="chain-group__links">
              <router-link :to="`/sheets/${group.sheet.id}`">图幅详情</router-link>
              <router-link :to="`/sheets/${group.sheet.id}/neighbors`">邻接预览</router-link>
            </span>
          </header>

          <p v-for="field in extraFields(group.sheet.fields, ['图幅号', '题名'])" :key="`sheet-${field.label}`" class="chain-field">
            <span class="chain-field__label">{{ field.label }}</span>
            <HighlightParts :parts="field.parts" />
          </p>

          <div v-if="group.scans.length" class="chain-section">
            <h3>扫描件命中</h3>
            <div v-for="scan in group.scans" :key="scan.id" class="chain-item" data-testid="hit-scan">
              <router-link :to="`/sheets/${group.sheet.id}`" class="chain-item__title">
                <HighlightParts v-if="fieldParts(scan.fields, '扫描件名')" :parts="fieldParts(scan.fields, '扫描件名')!" />
                <template v-else>{{ scan.fileName }}</template>
              </router-link>
              <p v-for="field in extraFields(scan.fields, ['扫描件名'])" :key="`scan-${scan.id}-${field.label}`" class="chain-field">
                <span class="chain-field__label">{{ field.label }}</span>
                <HighlightParts :parts="field.parts" />
              </p>
            </div>
          </div>

          <div v-if="group.pairs.length" class="chain-section">
            <h3>地名命中</h3>
            <div v-for="pair in group.pairs" :key="pair.id" class="chain-item" data-testid="hit-pair">
              <div class="chain-item__names">
                <strong>
                  <HighlightParts v-if="fieldParts(pair.fields, '古名')" :parts="fieldParts(pair.fields, '古名')!" />
                  <template v-else>{{ pair.oldName }}</template>
                </strong>
                <span class="chain-item__arrow" aria-hidden="true">→</span>
                <strong class="chain-item__new">
                  <HighlightParts v-if="fieldParts(pair.fields, '新名')" :parts="fieldParts(pair.fields, '新名')!" />
                  <template v-else>{{ pair.newName }}</template>
                </strong>
                <router-link :to="`/places/${pair.id}/history`" class="chain-item__link">沿革时间线</router-link>
              </div>
              <p v-for="field in extraFields(pair.fields, ['古名', '新名'])" :key="`pair-${pair.id}-${field.label}`" class="chain-field">
                <span class="chain-field__label">{{ field.label }}</span>
                <HighlightParts :parts="field.parts" />
              </p>
              <div v-if="pair.histories.length" class="chain-histories">
                <div v-for="history in pair.histories" :key="history.id" class="chain-history" data-testid="hit-history">
                  <span class="chain-history__period">
                    <HighlightParts v-if="fieldParts(history.fields, '年代')" :parts="fieldParts(history.fields, '年代')!" />
                    <template v-else>{{ history.period }}</template>
                  </span>
                  <strong>
                    <HighlightParts v-if="fieldParts(history.fields, '沿革名称')" :parts="fieldParts(history.fields, '沿革名称')!" />
                    <template v-else>{{ history.name }}</template>
                  </strong>
                  <p v-for="field in extraFields(history.fields, ['年代', '沿革名称'])" :key="`hist-${history.id}-${field.label}`" class="chain-field">
                    <span class="chain-field__label">{{ field.label }}</span>
                    <HighlightParts :parts="field.parts" />
                  </p>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>

    <div v-else-if="searchStore.updating && searchStore.keyword.trim()" class="vacant-hint">
      <h2>正在计算结果…</h2>
      <p>索引就绪后自动展示，期间不清空上一份完整结果。</p>
    </div>

    <VacantHint
      v-else-if="snapshot"
      title="没有命中的条目"
      description="换用图幅号、古名、新名、异写、沿革年代或扫描件名中的其他关键词试试。"
      action-text="清空关键词"
      @action="searchStore.keyword = ''; focusInput()"
    />

    <VacantHint
      v-else
      title="输入关键词开始本地检索"
      description="可检索图幅号、古名、新名、异写、沿革与扫描件名；命中后沿关联链回到所属图幅与扫描件。"
      action-text="聚焦输入框"
      @action="focusInput"
    />
  </section>
</template>

<style scoped>
.index-status {
  margin-bottom: 20px;
}

.index-status__actions {
  display: flex;
  gap: 8px;
}

.index-status__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.index-status__line strong {
  color: var(--accent-dark);
  font-size: 17px;
}

.index-status__note {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.updating-banner {
  margin-bottom: 18px;
}

.chain-list {
  display: grid;
  gap: 16px;
}

.chain-group {
  padding: 18px 20px;
  background: rgba(250, 245, 236, 0.97);
  border: 1px solid #d4c3ae;
  border-radius: 9px;
  box-shadow: 0 6px 16px rgba(76, 51, 31, 0.07);
}

.chain-group__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px dashed #d1bfa9;
}

.chain-group__code {
  color: var(--accent-dark);
  font-family: Georgia, "Songti SC", serif;
  font-size: 19px;
  font-weight: 700;
}

.chain-group__title {
  font-weight: 600;
}

.chain-group__meta {
  color: var(--muted);
  font-size: 12px;
}

.chain-group__links {
  display: flex;
  gap: 12px;
  margin-left: auto;
  font-size: 12px;
}

.chain-group__links a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.chain-section {
  margin-top: 14px;
}

.chain-section h3 {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.chain-item {
  padding: 10px 14px;
  margin-bottom: 8px;
  background: #fbf7ef;
  border: 1px solid #ddcfbd;
  border-left: 3px solid #9c7a5e;
  border-radius: 6px;
}

.chain-item__title {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.chain-item__names {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font-size: 16px;
}

.chain-item__arrow {
  color: #aa8c72;
}

.chain-item__new {
  color: var(--moss);
}

.chain-item__link {
  margin-left: auto;
  color: var(--accent);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.chain-field {
  margin: 6px 0 0;
  color: #655447;
  font-size: 13px;
  line-height: 1.7;
}

.chain-field__label {
  display: inline-block;
  min-width: 62px;
  margin-right: 8px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.chain-histories {
  margin-top: 8px;
  padding-left: 14px;
  border-left: 2px dashed #cbb8a2;
}

.chain-history {
  padding: 6px 0 6px 10px;
}

.chain-history__period {
  margin-right: 10px;
  color: var(--muted);
  font-size: 12px;
}
</style>

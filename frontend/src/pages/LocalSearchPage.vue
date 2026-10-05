<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLocalSearch } from '../hooks/useLocalSearch'
import { useSearchIndexStore } from '../stores/searchIndexStore'
import { SEARCH_FIELDS, type SearchField, type SearchRoot } from '../types/search'
import { splitHighlight } from '../hooks/usePlaceSearch'
const searchIndexStore = useSearchIndexStore()

const keyword = ref('')
const roots = ref<SearchRoot[]>(['sheet', 'place'])
const fields = ref<SearchField[]>([...SEARCH_FIELDS])

const { hits, total, page, pageCount, usablePage, searching, updating, hasSnapshot, goPage } =
  useLocalSearch(keyword, { roots, fields })

function toggleField(field: SearchField): void {
  if (fields.value.includes(field)) {
    fields.value = fields.value.filter((item) => item !== field)
  } else {
    fields.value = [...fields.value, field]
  }
}

const phaseText = computed(() => {
  const phase = searchIndexStore.phase
  if (phase === 'building') {
    return searchIndexStore.stage === 'sheets' ? '正在分批建立图幅索引' : '正在分批建立地名索引'
  }
  if (phase === 'paused') {
    return '重建已暂停，检查点已保留'
  }
  if (phase === 'error') {
    return '重建中断，可从检查点续做'
  }
  return searchIndexStore.pumping ? '正在只重算受影响条目' : ''
})

const showSkeleton = computed(
  () => updating.value && !hasSnapshot.value,
)
const showStaleBanner = computed(
  () => updating.value && hasSnapshot.value,
)

function partsFor(text: string) {
  return splitHighlight(text, keyword.value)
}

function hitTitle(hit: (typeof hits.value)[number]): string {
  return hit.doc.root === 'sheet'
    ? hit.chain.sheetCode || '未命名图幅'
    : hit.doc.fields.find((field) => field.field === '古名')?.text ?? '未命名地名'
}

function hitSubtitle(hit: (typeof hits.value)[number]): string {
  if (hit.doc.root === 'sheet') {
    return hit.chain.sheetTitle
  }
  return hit.doc.fields.find((field) => field.field === '今名')?.text ?? ''
}

function hitLink(hit: (typeof hits.value)[number]): string {
  return hit.doc.root === 'sheet'
    ? `/sheets/${hit.doc.sourceId}`
    : `/places/${hit.doc.sourceId}/history`
}

const fieldLabels: Record<SearchField, string> = {
  图幅号: '图幅号',
  图幅题名: '图幅题名',
  古名: '古名',
  今名: '今名',
  异写: '异写',
  沿革: '沿革',
  扫描件名: '扫描件名',
  图上方位: '图上方位',
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">LOCAL FULL-CHAIN SEARCH</span>
        <h1>本地关联检索</h1>
        <p>沿图幅号、古名、今名、异写、沿革与扫描件名回到关联链。索引分批建立并留检查点，更新期间保留上一版完整结果。</p>
      </div>
    </div>

    <!-- 索引生命周期面板 -->
    <div class="index-panel" data-testid="index-panel">
      <template v-if="searchIndexStore.ready && !searchIndexStore.pumping">
        <el-tag type="success" effect="dark">索引可用</el-tag>
        <span class="muted">最近更新：{{ searchIndexStore.meta?.updatedAt ? new Date(searchIndexStore.meta.updatedAt).toLocaleString('zh-CN') : '—' }}</span>
      </template>
      <template v-else>
        <el-tag :type="searchIndexStore.phase === 'error' ? 'danger' : 'warning'" effect="dark">
          {{ phaseText }}
        </el-tag>
        <el-progress
          v-if="searchIndexStore.phase === 'building' || searchIndexStore.phase === 'paused'"
          :percentage="searchIndexStore.progressPercent"
          :stroke-width="12"
          class="index-panel__grow"
        />
        <span class="muted">
          已建 {{ searchIndexStore.processedCount }} / {{ searchIndexStore.meta?.totalSource ?? '—' }} 条
          <template v-if="searchIndexStore.meta?.checkpointAt">
            · 检查点 {{ new Date(searchIndexStore.meta.checkpointAt).toLocaleTimeString('zh-CN') }}
          </template>
        </span>
      </template>
      <div style="margin-left: auto; display: flex; gap: 8px">
        <el-button
          v-if="searchIndexStore.phase === 'building'"
          size="small"
          data-testid="index-cancel"
          @click="searchIndexStore.cancel()"
        >
          取消并留检查点
        </el-button>
        <el-button
          v-if="searchIndexStore.phase === 'paused' || searchIndexStore.phase === 'error'"
          type="primary"
          size="small"
          data-testid="index-resume"
          @click="searchIndexStore.resume()"
        >
          从检查点续做
        </el-button>
        <el-button size="small" data-testid="index-rebuild" @click="searchIndexStore.rebuildFromScratch()">
          分批重建索引
        </el-button>
      </div>
      <p v-if="searchIndexStore.meta?.error" class="text-danger" style="width: 100%">
        上次中断原因：{{ searchIndexStore.meta.error }}
      </p>
    </div>

    <!-- 快照提示：更新中但有旧结果 -->
    <div v-if="showStaleBanner" class="index-banner" data-testid="search-updating">
      <el-tag type="warning" effect="dark">结果更新中</el-tag>
      <span class="muted">
        正在分批重算，页面保留上一版完整结果；未算完前新旧条目不混排，完成后整批替换。
        <template v-if="searching">（正在执行检索…）</template>
      </span>
    </div>

    <!-- 检索条件 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        clearable
        placeholder="图幅号 / 古名 / 今名 / 异写 / 沿革 / 扫描件名"
        class="filter-bar__grow"
        data-testid="search-keyword"
        :disabled="showSkeleton"
      />
      <el-checkbox-group v-model="roots" aria-label="按条目类型过滤">
        <el-checkbox-button label="sheet">图幅</el-checkbox-button>
        <el-checkbox-button label="place">地名</el-checkbox-button>
      </el-checkbox-group>
      <span class="filter-count">命中：<strong data-testid="search-total">{{ total }}</strong></span>
    </div>

    <div class="filter-bar" style="margin-top: -8px">
      <el-checkbox
        v-for="field in SEARCH_FIELDS"
        :key="field"
        :model-value="fields.includes(field)"
        :disabled="showSkeleton"
        @change="toggleField(field)"
      >
        {{ fieldLabels[field] }}
      </el-checkbox>
    </div>

    <!-- 首次建立且无快照：只显示建立状态，不显示半截结果 -->
    <div v-if="showSkeleton" class="search-skeleton" data-testid="search-building">
      <el-skeleton :rows="6" animated />
      <p class="muted">
        首次建立或视图损坏后正在分批重建索引。每批完成即落检查点，失败、取消或重开页面都会从断点续做，且不添重复条目。
      </p>
    </div>

    <!-- 结果列表（快照：未完成替换前始终是整版旧结果） -->
    <div v-else-if="hits.length || keyword" class="search-results" data-testid="search-results">
      <article v-for="hit in hits" :key="hit.doc.docId" class="search-result-card" data-testid="search-row">
        <header class="search-result-card__head">
          <el-tag :type="hit.doc.root === 'sheet' ? 'info' : 'success'" effect="plain">
            {{ hit.doc.root === 'sheet' ? '图幅' : '地名' }}
          </el-tag>
          <router-link :to="hitLink(hit)" class="search-result-card__title">
            <template v-for="(part, index) in partsFor(hitTitle(hit))" :key="`title-${index}`">
              <mark v-if="part.matched">{{ part.text }}</mark>
              <span v-else>{{ part.text }}</span>
            </template>
          </router-link>
          <span v-if="hitSubtitle(hit)" class="muted">
            <template v-for="(part, index) in partsFor(hitSubtitle(hit))" :key="`sub-${index}`">
              <mark v-if="part.matched">{{ part.text }}</mark>
              <span v-else>{{ part.text }}</span>
            </template>
          </span>
        </header>

        <div class="search-result-card__matches">
          <div
            v-for="(fieldHit, fieldIndex) in hit.matchedFields"
            :key="`${fieldHit.field}-${fieldIndex}`"
            class="search-result-card__match"
          >
            <span class="search-result-card__field">{{ fieldLabels[fieldHit.field] }}</span>
            <span>
              <template v-for="(part, partIndex) in partsFor(fieldHit.text)" :key="fieldIndex * 100 + partIndex">
                <mark v-if="part.matched">{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
          </div>
        </div>

        <!-- 关联链 -->
        <div class="index-chain">
          <div class="index-chain__row">
            <span class="index-chain__label">关联图幅</span>
            <router-link v-if="hit.doc.root === 'place'" :to="`/sheets/${hit.chain.sheetId}`">
              {{ hit.chain.sheetCode }} · {{ hit.chain.sheetTitle }}
            </router-link>
            <span v-else>{{ hit.chain.sheetCode }} · {{ hit.chain.sheetTitle }}</span>
          </div>
          <div v-if="hit.chain.scanFileNames.length" class="index-chain__row">
            <span class="index-chain__label">扫描件</span>
            <span v-for="(name, scanIndex) in hit.chain.scanFileNames" :key="name">
              <template v-for="(part, partIndex) in partsFor(name)" :key="`scan-${scanIndex}-${partIndex}`">
                <mark v-if="part.matched">{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
              <span v-if="scanIndex < hit.chain.scanFileNames.length - 1">、</span>
            </span>
          </div>
          <div v-if="hit.doc.root === 'place' && hit.chain.placePairId" class="index-chain__row">
            <span class="index-chain__label">沿革线索</span>
            <router-link :to="`/places/${hit.chain.placePairId}/history`">展开沿革时间线 →</router-link>
          </div>
        </div>
      </article>

      <div v-if="total === 0" class="empty-inline" data-testid="search-empty">
        没有命中的条目，可尝试更换关键词或勾选更多检索字段。
      </div>

      <div v-if="pageCount > 1" class="index-pager">
        <el-button size="small" :disabled="usablePage <= 1" data-testid="search-prev" @click="goPage(usablePage - 1)">
          上一页
        </el-button>
        <span class="muted">第 {{ usablePage }} / {{ pageCount }} 页</span>
        <el-button
          size="small"
          :disabled="usablePage >= pageCount"
          data-testid="search-next"
          @click="goPage(usablePage + 1)"
        >
          下一页
        </el-button>
      </div>
    </div>

    <div v-else class="search-placeholder" data-testid="search-placeholder">
      <p class="muted">输入关键词开始检索；关联链会把图幅、扫描件、地名与沿革一并带回。</p>
    </div>
  </section>
</template>

<style scoped>
.search-skeleton {
  max-width: 720px;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(244, 237, 225, 0.5);
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.search-result-card {
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fffdf7;
}

.search-result-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.search-result-card__title {
  font-size: 17px;
  font-weight: 700;
  color: var(--accent-dark);
}

.search-result-card__matches {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  font-size: 14px;
}

.search-result-card__match {
  display: flex;
  gap: 10px;
}

.search-result-card__field {
  flex: 0 0 64px;
  color: var(--muted);
  font-size: 12px;
  padding-top: 2px;
}

.search-placeholder {
  padding: 48px 0;
  text-align: center;
}

mark {
  background: rgba(201, 163, 90, 0.35);
  padding: 0 2px;
  border-radius: 2px;
}
</style>

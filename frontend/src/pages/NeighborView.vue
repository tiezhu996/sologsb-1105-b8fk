<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSheetStore } from '../stores/sheetStore'
import { useSheetNeighbors, type NeighborDirection, type NeighborEntry } from '../hooks/useSheetNeighbors'
import type { ScanItem } from '../types/scan'
import ScanCard from '../components/common/ScanCard.vue'
import ScaleTag from '../components/common/ScaleTag.vue'
import VacantHint from '../components/common/VacantHint.vue'

const route = useRoute()
const sheetStore = useSheetStore()
const sheetId = computed(() => String(route.params.id ?? ''))
const { status } = useSheetNeighbors(sheetId)
const source = computed(() => status.value.source)

function entryAt(direction: NeighborDirection): NeighborEntry | undefined {
  return status.value.entries.find((entry) => entry.direction === direction)
}

function primaryScan(sheetIdToFind: string): ScanItem | undefined {
  return sheetStore.getScansForSheet(sheetIdToFind).find((scan) => scan.isPrimary)
}

const sourcePrimaryScan = computed(() => (source.value ? primaryScan(source.value.id) : undefined))

async function initialize(): Promise<void> {
  await sheetStore.init()
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <section v-if="source" class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">NEIGHBOR ASSEMBLY</span>
        <h1>{{ source.code }} 邻接与拼合预览</h1>
        <p>按东、南、西、北排列相邻图幅，以主用扫描件核对接边，并明确尚缺图幅。</p>
      </div>
      <router-link :to="`/sheets/${source.id}`"><el-button>返回图幅详情</el-button></router-link>
    </div>

    <div class="metrics-strip">
      <div class="metric">
        <span>登记邻接图</span>
        <strong>{{ status.adjacentCount }}</strong><small>幅</small>
      </div>
      <div class="metric">
        <span>馆藏齐备</span>
        <strong>{{ status.adjacentCount - status.missingCodes.length }}</strong><small>幅</small>
      </div>
      <div class="metric">
        <span>缺编图幅</span>
        <strong>{{ status.missingCodes.length }}</strong><small>幅</small>
      </div>
    </div>

    <div class="neighbor-map">
      <article class="neighbor-slot slot-north">
        <span class="neighbor-slot__direction">北 · NORTH</span>
        <template v-if="entryAt('北')">
          <template v-if="entryAt('北')?.sheet">
            <h3>{{ entryAt('北')?.sheet?.code }}</h3>
            <p>{{ entryAt('北')?.sheet?.title }}</p>
            <router-link :to="`/sheets/${entryAt('北')?.sheet?.id}`"><el-button link type="primary">查看图幅</el-button></router-link>
          </template>
          <template v-else>
            <h3 class="text-danger">{{ entryAt('北')?.code }}</h3>
            <p>馆藏缺编，需补图后再核接边。</p>
          </template>
        </template>
        <p v-else>该方向未登记邻接关系。</p>
      </article>

      <article class="neighbor-slot slot-west">
        <span class="neighbor-slot__direction">西 · WEST</span>
        <template v-if="entryAt('西')">
          <template v-if="entryAt('西')?.sheet">
            <h3>{{ entryAt('西')?.sheet?.code }}</h3>
            <p>{{ entryAt('西')?.sheet?.title }}</p>
            <router-link :to="`/sheets/${entryAt('西')?.sheet?.id}`"><el-button link type="primary">查看图幅</el-button></router-link>
          </template>
          <template v-else>
            <h3 class="text-danger">{{ entryAt('西')?.code }}</h3>
            <p>馆藏缺编，需补图后再核接边。</p>
          </template>
        </template>
        <p v-else>该方向未登记邻接关系。</p>
      </article>

      <article class="neighbor-slot neighbor-slot--center slot-center">
        <span class="neighbor-slot__direction">当前图幅 · CENTER</span>
        <h3>{{ source.code }}</h3>
        <p>{{ source.title }}</p>
        <ScaleTag :year="source.year" :scale="source.scale" />
        <div v-if="sourcePrimaryScan" class="mt-20">
          <ScanCard :scan="sourcePrimaryScan" />
        </div>
        <p v-else class="mt-20">尚未标记主用扫描件。</p>
      </article>

      <article class="neighbor-slot slot-east">
        <span class="neighbor-slot__direction">东 · EAST</span>
        <template v-if="entryAt('东')">
          <template v-if="entryAt('东')?.sheet">
            <h3>{{ entryAt('东')?.sheet?.code }}</h3>
            <p>{{ entryAt('东')?.sheet?.title }}</p>
            <router-link :to="`/sheets/${entryAt('东')?.sheet?.id}`"><el-button link type="primary">查看图幅</el-button></router-link>
          </template>
          <template v-else>
            <h3 class="text-danger">{{ entryAt('东')?.code }}</h3>
            <p>馆藏缺编，需补图后再核接边。</p>
          </template>
        </template>
        <p v-else>该方向未登记邻接关系。</p>
      </article>

      <article class="neighbor-slot slot-south">
        <span class="neighbor-slot__direction">南 · SOUTH</span>
        <template v-if="entryAt('南')">
          <template v-if="entryAt('南')?.sheet">
            <h3>{{ entryAt('南')?.sheet?.code }}</h3>
            <p>{{ entryAt('南')?.sheet?.title }}</p>
            <router-link :to="`/sheets/${entryAt('南')?.sheet?.id}`"><el-button link type="primary">查看图幅</el-button></router-link>
          </template>
          <template v-else>
            <h3 class="text-danger">{{ entryAt('南')?.code }}</h3>
            <p>馆藏缺编，需补图后再核接边。</p>
          </template>
        </template>
        <p v-else>该方向未登记邻接关系。</p>
      </article>

      <article v-if="entryAt('东北')" class="neighbor-slot slot-northeast">
        <span class="neighbor-slot__direction">东北 · NE</span>
        <template v-if="entryAt('东北')?.sheet">
          <h3>{{ entryAt('东北')?.sheet?.code }}</h3>
          <p>{{ entryAt('东北')?.sheet?.title }}</p>
        </template>
        <template v-else>
          <h3 class="text-danger">{{ entryAt('东北')?.code }}</h3>
          <p>馆藏缺编</p>
        </template>
      </article>

      <article v-if="entryAt('西南')" class="neighbor-slot slot-southwest">
        <span class="neighbor-slot__direction">西南 · SW</span>
        <template v-if="entryAt('西南')?.sheet">
          <h3>{{ entryAt('西南')?.sheet?.code }}</h3>
          <p>{{ entryAt('西南')?.sheet?.title }}</p>
        </template>
        <template v-else>
          <h3 class="text-danger">{{ entryAt('西南')?.code }}</h3>
          <p>馆藏缺编</p>
        </template>
      </article>
    </div>

    <div v-if="status.missingCodes.length" class="section-title">
      <div>
        <h2>缺编提示</h2>
        <p class="muted">以下邻接图号尚未建立本地图幅卡：{{ status.missingCodes.join('、') }}</p>
      </div>
    </div>
  </section>

  <section v-else class="page">
    <h1>图幅邻接与拼合预览</h1>
    <VacantHint title="未找到该图幅" description="请返回图幅编目台重新选择记录。" />
  </section>
</template>

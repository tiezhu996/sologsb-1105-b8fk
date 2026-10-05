<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { usePlaceStore, type NewPlacePair } from '../stores/placeStore'
import { useSheetStore } from '../stores/sheetStore'
import type { Certainty, PlacePair, PlaceType } from '../types/placePair'
import { CERTAINTIES, PLACE_TYPES } from '../types/placePair'
import { usePlaceSearch } from '../hooks/usePlaceSearch'
import PairRow from '../components/common/PairRow.vue'
import VacantHint from '../components/common/VacantHint.vue'

const placeStore = usePlaceStore()
const sheetStore = useSheetStore()
const { matches } = usePlaceSearch(placeStore.keyword)

const showCreateForm = ref(false)
const formError = ref('')

function createEmptyForm(): NewPlacePair {
  return {
    sheetId: sheetStore.sheets[0]?.id ?? '',
    oldName: '',
    newName: '',
    aliasList: [],
    placeType: '村镇',
    coordNote: '',
    certainty: '确定',
  }
}

const form = reactive<NewPlacePair>(createEmptyForm())
const aliasInput = ref('')

const visiblePairs = computed(() =>
  placeStore.filteredPairs.filter((pair) => matches(pair)).sort((left, right) => {
    const sheetCompare = (sheetStore.getSheetById(left.sheetId)?.year ?? 0) - (sheetStore.getSheetById(right.sheetId)?.year ?? 0)
    return sheetCompare || left.oldName.localeCompare(right.oldName, 'zh-CN')
  }),
)

function getSheetCode(pair: PlacePair): string {
  return sheetStore.getSheetById(pair.sheetId)?.code ?? '图幅待补'
}

function resetForm(): void {
  Object.assign(form, createEmptyForm())
  aliasInput.value = ''
  formError.value = ''
}

async function submitPlace(): Promise<void> {
  if (!form.sheetId || !form.oldName.trim() || !form.newName.trim()) {
    formError.value = '请选择所属图幅，并填写古名与今名。'
    return
  }
  await placeStore.addPair({
    ...form,
    oldName: form.oldName.trim(),
    newName: form.newName.trim(),
    coordNote: form.coordNote.trim() || '图上方位待核',
    aliasList: aliasInput.value
      .split(/[、，,]/)
      .map((alias) => alias.trim())
      .filter(Boolean),
  })
  resetForm()
  showCreateForm.value = false
}

async function initialize(): Promise<void> {
  await Promise.all([sheetStore.init(), placeStore.init()])
  if (!form.sheetId) {
    form.sheetId = sheetStore.sheets[0]?.id ?? ''
  }
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">GAZETTEER CROSS-REFERENCE</span>
        <h1>地名对照台</h1>
        <p>并置古地图旧名与现代地名，收录异写异读、图上方位和核证程度，供地名反向查询与交叉复核。</p>
      </div>
      <el-button type="primary" size="large" data-testid="new-place" @click="showCreateForm = true">
        新建地名对照
      </el-button>
    </div>

    <form v-if="showCreateForm" class="inline-form" data-testid="form-place" @submit.prevent="submitPlace">
      <h2>新建古今地名对照</h2>
      <div class="form-grid">
        <el-form-item label="所属图幅" required>
          <select v-model="form.sheetId" class="native-field" data-testid="field-sheetId">
            <option v-for="sheet in sheetStore.sheets" :key="sheet.id" :value="sheet.id">
              {{ sheet.code }} · {{ sheet.title }}
            </option>
          </select>
        </el-form-item>
        <el-form-item label="图上旧名" required>
          <input v-model="form.oldName" class="native-field" data-testid="field-oldName" />
        </el-form-item>
        <el-form-item label="今地名" required>
          <input v-model="form.newName" class="native-field" data-testid="field-newName" />
        </el-form-item>
        <el-form-item label="地名类型" required>
          <select v-model="form.placeType" class="native-field" data-testid="field-placeType">
            <option v-for="placeType in PLACE_TYPES" :key="placeType" :value="placeType">{{ placeType }}</option>
          </select>
        </el-form-item>
        <el-form-item label="确定度" required>
          <select v-model="form.certainty" class="native-field" data-testid="field-certainty">
            <option v-for="certainty in CERTAINTIES" :key="certainty" :value="certainty">{{ certainty }}</option>
          </select>
        </el-form-item>
        <el-form-item label="异写异读">
          <input v-model="aliasInput" class="native-field" data-testid="field-aliasList" placeholder="多个异写用逗号分隔" />
        </el-form-item>
        <el-form-item label="图上方位" required class="form-grid__wide">
          <textarea v-model="form.coordNote" class="native-field" data-testid="field-coordNote" rows="3"></textarea>
        </el-form-item>
        <div class="form-actions">
          <el-button @click="showCreateForm = false; resetForm()">取消</el-button>
          <el-button type="primary" native-type="submit" data-testid="submit-place">保存对照</el-button>
        </div>
      </div>
      <p v-if="formError" class="text-danger">{{ formError }}</p>
    </form>

    <div class="filter-bar">
      <el-input v-model="placeStore.keyword" clearable placeholder="输入古名、今名、异写或图上方位，反向查询" class="filter-bar__grow" />
      <el-select v-model="placeStore.placeTypeFilter" style="width: 130px" aria-label="按地名类型筛选">
        <el-option label="全部类型" value="全部" />
        <el-option v-for="placeType in PLACE_TYPES" :key="placeType" :label="placeType" :value="placeType" />
      </el-select>
      <el-select v-model="placeStore.certaintyFilter" style="width: 130px" aria-label="按确定度筛选">
        <el-option label="全部确定度" value="全部" />
        <el-option v-for="certainty in CERTAINTIES" :key="certainty" :label="certainty" :value="certainty" />
      </el-select>
      <span class="filter-count">当前记录数：<strong data-testid="count-place">{{ visiblePairs.length }}</strong></span>
    </div>

    <div v-if="visiblePairs.length" class="place-list">
      <div v-for="pair in visiblePairs" :key="pair.id" data-testid="row-place">
        <PairRow :pair="pair" :query="placeStore.keyword" :sheet-code="getSheetCode(pair)" />
        <div class="pair-row-actions">
          <router-link :to="`/places/${pair.id}/history`">
            <el-button link type="primary">展开沿革时间线</el-button>
          </router-link>
        </div>
      </div>
    </div>

    <VacantHint
      v-else
      title="没有命中的地名记录"
      description="换用古名、今名、异写或图上方位中的任意关键词，或者新建一条地名对照。"
      action-text="新建地名对照"
      @action="showCreateForm = true"
    />
  </section>
</template>

<style scoped>
.form-grid__wide {
  grid-column: span 2;
}

.pair-row-actions {
  display: flex;
  justify-content: flex-end;
  padding: 5px 12px 0;
}

@media (max-width: 680px) {
  .form-grid__wide {
    grid-column: auto;
  }
}
</style>

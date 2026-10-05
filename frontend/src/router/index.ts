import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import SheetList from '../pages/SheetList.vue'
import SheetDetail from '../pages/SheetDetail.vue'
import PlaceBoard from '../pages/PlaceBoard.vue'
import HistoryTimeline from '../pages/HistoryTimeline.vue'
import NeighborView from '../pages/NeighborView.vue'
import LocalSearchPage from '../pages/LocalSearchPage.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/sheets' },
  { path: '/sheets', name: 'sheets', component: SheetList },
  { path: '/sheets/:id', name: 'sheet-detail', component: SheetDetail },
  { path: '/places', name: 'places', component: PlaceBoard },
  { path: '/places/:id/history', name: 'place-history', component: HistoryTimeline },
  { path: '/sheets/:id/neighbors', name: 'sheet-neighbors', component: NeighborView },
  { path: '/search', name: 'local-search', component: LocalSearchPage },
  { path: '/:pathMatch(.*)*', redirect: '/sheets' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

export default router

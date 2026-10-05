import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { useSearchIndexStore } from './stores/searchIndexStore'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia).use(ElementPlus).use(router).mount('#app')

// 后台建立 / 恢复本地检索索引：有检查点则续做，视图损坏则分批重建，不阻塞首屏。
const searchIndexStore = useSearchIndexStore(pinia)
void searchIndexStore.boot()

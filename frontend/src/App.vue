<script setup lang="ts">
const navigation = [
  { label: '图幅编目台', to: '/sheets', hint: '编目与筛选' },
  { label: '地名对照台', to: '/places', hint: '古今与异写' },
  { label: '沿革时间线', to: '/places/place-bp-yi-3-1/history', hint: '年代脉络' },
  { label: '邻接拼合预览', to: '/sheets/sheet-bp-yi-3/neighbors', hint: '四至关系' },
]
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <router-link class="brand" to="/sheets" aria-label="返回图幅编目台">
        <span class="brand__seal" aria-hidden="true">图</span>
        <span>
          <strong>老地图图幅编目台</strong>
          <small>gboldmap · 地方文献整理工具</small>
        </span>
      </router-link>
      <div class="site-header__status">
        <span class="status-dot" aria-hidden="true"></span>
        本地典藏数据
      </div>
    </header>

    <aside class="site-nav" aria-label="主要导航">
      <p class="site-nav__eyebrow">整理工作台</p>
      <nav>
        <router-link v-for="item in navigation" :key="item.to" :to="item.to" class="nav-link">
          <span>{{ item.label }}</span>
          <small>{{ item.hint }}</small>
        </router-link>
      </nav>
      <div class="site-nav__foot">
        <svg viewBox="0 0 120 72" aria-hidden="true">
          <path d="M9 59h24V42h14v17h18V23h14v36h32" fill="none" stroke="currentColor" stroke-width="3" />
          <path d="M8 21l23-10 19 11 32-13 29 12v38l-29 10-32-12-19 11-23-10z" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M31 11v47M50 22v38M82 9v49" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 4" />
        </svg>
        <p>按图幅、扫描件、地名与沿革逐层建档</p>
      </div>
    </aside>

    <main class="site-main">
      <router-view />
    </main>
  </div>
</template>

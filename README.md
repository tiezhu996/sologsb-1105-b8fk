# 老地图图幅编目与地名对照台

面向古地图整理者和地方志研究者，将老地图按图幅编目，登记年代、比例尺、投影和扫描件，并建立古今地名对照及沿革线索。应用为纯前端单页程序，所有资料保存在浏览器本地。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

服务默认映射到宿主端口 `21805`。停止服务可执行：

```bash
docker compose down
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 + TypeScript |
| 构建工具 | Vite 5 |
| UI 组件 | Element Plus |
| 状态管理 | Pinia |
| 前端路由 | Vue Router 4 |
| 本地数据 | IndexedDB + Dexie 4 |
| 容器运行 | Nginx Alpine |

## 访问地址

浏览器访问 [http://localhost:21805](http://localhost:21805)。

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

开发服务器默认使用 `5173` 端口。执行 `npm run build` 可进行 TypeScript 检查并生成生产构建。

## 目录结构

```text
.
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/common/   # 扫描件、地名行、比例尺标签与空态
│   │   ├── hooks/               # 地名反向检索、图幅邻接解析
│   │   ├── pages/               # 五个业务页面
│   │   ├── router/              # 路由表
│   │   ├── stores/              # 图幅、地名、沿革状态
│   │   ├── types/               # 数据模型与枚举
│   │   ├── utils/               # Dexie、比例尺换算与导出
│   │   ├── App.vue
│   │   ├── main.ts
│   │   └── style.css
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## 数据存储说明

应用使用 IndexedDB 持久化数据，Dexie 数据库名为 `gboldmap-db`。数据库包含 `sheets`、`scans`、`placePairs`、`histories` 四个对象仓库：

- `version(1)` 建立首版索引结构，并在首次创建数据库时写入图幅、扫描件、地名对照和沿革种子数据。
- `version(2)` 保持现有索引并对已有图幅执行 `schemaRev = 2` 的回填迁移，用于演示后续结构升级路径。

刷新或关闭页面不会丢失新增记录；浏览器站点数据被清除时会重新触发首次种子数据写入。

## 核心功能与路由表

| 路由 | 核心功能 |
| --- | --- |
| `/sheets` | 按年代、比例尺和状态筛选图幅，内联新建图幅，查看扫描件数、地名数与邻接缺编提示 |
| `/sheets/:id` | 查看编制摘要、扫描件条目、主用件切换、图内地名检索及 JSON 导出 |
| `/places` | 古今地名双栏对照，按类型和确定度筛选，对古名、今名、异写及图上方位反向查询并高亮 |
| `/places/:id/history` | 按年代排列沿革时间线，新增初置、改名、迁治或废置记录 |
| `/sheets/:id/neighbors` | 按四至排列邻接图幅，显示主用扫描件、缺编提示与拼合预览 |
| `/`、未匹配路径 | 自动跳转到 `/sheets` |

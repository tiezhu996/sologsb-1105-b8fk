import Dexie, { type Table } from 'dexie'
import type { NameHistory } from '../types/history'
import type { PlacePair } from '../types/placePair'
import type { ScanItem } from '../types/scan'
import type { Sheet } from '../types/sheet'

const sheets: Sheet[] = [
  {
    id: 'sheet-bp-jia-3',
    code: '北平-甲-3',
    title: '正阳门至崇文门街巷图',
    year: 1907,
    scale: '1:5000',
    projection: '三角测量 · 平面图',
    sheetSizeCm: '58 × 46 厘米',
    series: '京师实测图',
    neighborCodes: ['北平-甲-2', '北平-甲-4', '北平-乙-3'],
    status: '已编',
  },
  {
    id: 'sheet-bp-yi-3',
    code: '北平-乙-3',
    title: '东单至朝阳门内街巷图',
    year: 1921,
    scale: '1:5000',
    projection: '三角测量 · 平面图',
    sheetSizeCm: '58 × 46 厘米',
    series: '京师实测图',
    neighborCodes: ['北平-甲-3', '北平-乙-2', '北平-乙-4', '北平-丙-3'],
    status: '待核',
  },
  {
    id: 'sheet-bp-bing-5',
    code: '北平-丙-5',
    title: '北平近郊地形总图',
    year: 1935,
    scale: '1:50000',
    projection: '多圆锥投影',
    sheetSizeCm: '52 × 44 厘米',
    series: '河北五万分一图',
    neighborCodes: ['北平-丙-4', '北平-丙-6', '北平-丁-5'],
    status: '待编',
  },
  {
    id: 'sheet-tj-dong-2',
    code: '天津-东-2',
    title: '海河东岸及东车站一带',
    year: 1907,
    scale: '1:5000',
    projection: '三角测量 · 平面图',
    sheetSizeCm: '56 × 48 厘米',
    series: '津门实测图',
    neighborCodes: ['天津-东-1', '天津-东-3', '天津-中-2'],
    status: '已编',
  },
  {
    id: 'sheet-bd-zhong-4',
    code: '保定-中-4',
    title: '清苑县城厢及四关',
    year: 1921,
    scale: '1:50000',
    projection: '多圆锥投影',
    sheetSizeCm: '50 × 42 厘米',
    series: '直隶五万分一图',
    neighborCodes: ['保定-中-3', '保定-中-5', '保定-北-4', '保定-南-4'],
    status: '待核',
  },
  {
    id: 'sheet-kf-chengxi-1',
    code: '开封-城西-1',
    title: '大梁门至西门大街图',
    year: 1935,
    scale: '1:5000',
    projection: '三角测量 · 平面图',
    sheetSizeCm: '60 × 45 厘米',
    series: '河南省城实测图',
    neighborCodes: ['开封-城西-2', '开封-城中-1', '开封-城北-1'],
    status: '已编',
  },
]

const scans: ScanItem[] = [
  {
    id: 'scan-bp-jia-3-1',
    sheetId: 'sheet-bp-jia-3',
    fileName: '北平甲3_原图_600dpi.tif',
    resolutionDpi: 600,
    colorMode: '彩色',
    pieces: 4,
    quality: '清晰',
    storageNote: '市档案馆 D-17-04 铁柜',
    importedAt: '2025-02-18T09:30:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-bp-jia-3-2',
    sheetId: 'sheet-bp-jia-3',
    fileName: '北平甲3_蓝图复照.jpg',
    resolutionDpi: 300,
    colorMode: '黑白',
    pieces: 2,
    quality: '偏淡',
    storageNote: '研究室地图柜 3-2',
    importedAt: '2025-03-06T14:10:00.000Z',
    isPrimary: false,
  },
  {
    id: 'scan-bp-yi-3-1',
    sheetId: 'sheet-bp-yi-3',
    fileName: '北平乙3_内城东部_600dpi.tif',
    resolutionDpi: 600,
    colorMode: '灰度',
    pieces: 6,
    quality: '清晰',
    storageNote: '数字地图库 A-1921-07',
    importedAt: '2025-02-21T10:20:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-bp-yi-3-2',
    sheetId: 'sheet-bp-yi-3',
    fileName: '北平乙3_晒图本.jpg',
    resolutionDpi: 400,
    colorMode: '黑白',
    pieces: 3,
    quality: '破损',
    storageNote: '修复室待裱装盒 R-09',
    importedAt: '2025-03-15T16:00:00.000Z',
    isPrimary: false,
  },
  {
    id: 'scan-bp-bing-5-1',
    sheetId: 'sheet-bp-bing-5',
    fileName: '北平丙5_近郊总图_400dpi.tif',
    resolutionDpi: 400,
    colorMode: '彩色',
    pieces: 8,
    quality: '清晰',
    storageNote: '区域图库 B-1935-11',
    importedAt: '2025-01-12T08:45:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-bp-bing-5-2',
    sheetId: 'sheet-bp-bing-5',
    fileName: '北平丙5_馆藏缩微胶片.tif',
    resolutionDpi: 300,
    colorMode: '灰度',
    pieces: 4,
    quality: '偏淡',
    storageNote: '缩微胶片柜 M-22',
    importedAt: '2025-01-20T11:25:00.000Z',
    isPrimary: false,
  },
  {
    id: 'scan-tj-dong-2-1',
    sheetId: 'sheet-tj-dong-2',
    fileName: '天津东2_海河东岸_600dpi.tif',
    resolutionDpi: 600,
    colorMode: '彩色',
    pieces: 4,
    quality: '清晰',
    storageNote: '津图专藏 T-1907-02',
    importedAt: '2025-04-03T13:05:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-tj-dong-2-2',
    sheetId: 'sheet-tj-dong-2',
    fileName: '天津东2_石印本.jpg',
    resolutionDpi: 300,
    colorMode: '彩色',
    pieces: 2,
    quality: '偏淡',
    storageNote: '津图普通库 12-4',
    importedAt: '2025-04-05T09:15:00.000Z',
    isPrimary: false,
  },
  {
    id: 'scan-bd-zhong-4-1',
    sheetId: 'sheet-bd-zhong-4',
    fileName: '保定中4_城厢四关_600dpi.tif',
    resolutionDpi: 600,
    colorMode: '灰度',
    pieces: 6,
    quality: '清晰',
    storageNote: '直隶地图专柜 L-21',
    importedAt: '2025-03-11T15:40:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-bd-zhong-4-2',
    sheetId: 'sheet-bd-zhong-4',
    fileName: '保定中4_晒蓝副本.tif',
    resolutionDpi: 300,
    colorMode: '黑白',
    pieces: 3,
    quality: '破损',
    storageNote: '修复室临时箱 R-16',
    importedAt: '2025-03-19T10:00:00.000Z',
    isPrimary: false,
  },
  {
    id: 'scan-kf-chengxi-1-1',
    sheetId: 'sheet-kf-chengxi-1',
    fileName: '开封城西1_大梁门_600dpi.tif',
    resolutionDpi: 600,
    colorMode: '彩色',
    pieces: 5,
    quality: '清晰',
    storageNote: '河南文献库 H-1935-03',
    importedAt: '2025-05-08T09:50:00.000Z',
    isPrimary: true,
  },
  {
    id: 'scan-kf-chengxi-1-2',
    sheetId: 'sheet-kf-chengxi-1',
    fileName: '开封城西1_旧照底片.tif',
    resolutionDpi: 400,
    colorMode: '黑白',
    pieces: 2,
    quality: '偏淡',
    storageNote: '底片柜 P-08',
    importedAt: '2025-05-12T14:30:00.000Z',
    isPrimary: false,
  },
]

const placePairs: PlacePair[] = [
  {
    id: 'place-bp-jia-3-1',
    sheetId: 'sheet-bp-jia-3',
    oldName: '正阳门瓮城',
    newName: '正阳门',
    aliasList: ['前门瓮城', '正阳门月城'],
    placeType: '衙署',
    coordNote: '图幅中部偏南，城墙与护城河交汇处',
    certainty: '确定',
  },
  {
    id: 'place-bp-jia-3-2',
    sheetId: 'sheet-bp-jia-3',
    oldName: '崇文门大街',
    newName: '崇文门内大街',
    aliasList: ['哈德门大街', '崇文门里街'],
    placeType: '村镇',
    coordNote: '图幅东侧，由城门向北贯穿',
    certainty: '确定',
  },
  {
    id: 'place-bp-yi-3-1',
    sheetId: 'sheet-bp-yi-3',
    oldName: '东单牌楼',
    newName: '东单北大街',
    aliasList: ['东单牌楼大街', '就日坊'],
    placeType: '村镇',
    coordNote: '图幅西南部，东西长安街北侧',
    certainty: '确定',
  },
  {
    id: 'place-bp-yi-3-2',
    sheetId: 'sheet-bp-yi-3',
    oldName: '齐化门大街',
    newName: '朝阳门内大街',
    aliasList: ['朝阳门大街', '齐化门内街'],
    placeType: '村镇',
    coordNote: '图幅中部横向干道，东端接朝阳门',
    certainty: '确定',
  },
  {
    id: 'place-bp-bing-5-1',
    sheetId: 'sheet-bp-bing-5',
    oldName: '卢沟渡口',
    newName: '卢沟桥',
    aliasList: ['广利桥', '卢沟石桥'],
    placeType: '桥梁',
    coordNote: '图幅西南角，跨永定河古道',
    certainty: '确定',
  },
  {
    id: 'place-bp-bing-5-2',
    sheetId: 'sheet-bp-bing-5',
    oldName: '钓鱼台泊',
    newName: '玉渊潭',
    aliasList: ['玉渊潭湖', '钓鱼台水面'],
    placeType: '山川',
    coordNote: '图幅西部水泊，西邻阜成门外',
    certainty: '存疑',
  },
  {
    id: 'place-tj-dong-2-1',
    sheetId: 'sheet-tj-dong-2',
    oldName: '马家口渡',
    newName: '大光明桥',
    aliasList: ['马家渡', '马家口摆渡'],
    placeType: '桥梁',
    coordNote: '图幅中部跨海河，连接河东与英租界',
    certainty: '存疑',
  },
  {
    id: 'place-tj-dong-2-2',
    sheetId: 'sheet-tj-dong-2',
    oldName: '盐坨村',
    newName: '河北区建国道一带',
    aliasList: ['盐坨', '盐坨地'],
    placeType: '村镇',
    coordNote: '图幅东北部，近东车站货场',
    certainty: '待考',
  },
  {
    id: 'place-bd-zhong-4-1',
    sheetId: 'sheet-bd-zhong-4',
    oldName: '清苑县署',
    newName: '保定市莲池区',
    aliasList: ['清苑县衙', '保定府附郭县署'],
    placeType: '衙署',
    coordNote: '图幅中心偏西，城内主街北段',
    certainty: '确定',
  },
  {
    id: 'place-bd-zhong-4-2',
    sheetId: 'sheet-bd-zhong-4',
    oldName: '大慈阁街',
    newName: '大慈阁社区',
    aliasList: ['大慈阁前街', '真觉禅寺街'],
    placeType: '村镇',
    coordNote: '图幅东北部，靠近北门内大街',
    certainty: '确定',
  },
  {
    id: 'place-kf-chengxi-1-1',
    sheetId: 'sheet-kf-chengxi-1',
    oldName: '汴梁西门',
    newName: '大梁门',
    aliasList: ['大梁门城楼', '西门'],
    placeType: '衙署',
    coordNote: '图幅西端，城门与护城河相接',
    certainty: '确定',
  },
  {
    id: 'place-kf-chengxi-1-2',
    sheetId: 'sheet-kf-chengxi-1',
    oldName: '州桥旧址',
    newName: '州桥遗址',
    aliasList: ['汴州桥', '天汉桥'],
    placeType: '桥梁',
    coordNote: '图幅中部偏南，御街与汴河故道交会',
    certainty: '存疑',
  },
]

const histories: NameHistory[] = [
  { id: 'hist-01', placePairId: 'place-bp-jia-3-1', period: '明永乐十七年（1419）', name: '丽正门', changeType: '初置', sourceRef: '《京师坊巷志稿》卷一', note: '南城墙中门，正统初改称正阳门。' },
  { id: 'hist-02', placePairId: 'place-bp-jia-3-1', period: '明正统四年（1439）', name: '正阳门', changeType: '改名', sourceRef: '《明英宗实录》卷五十二', note: '增筑瓮城，门额定为正阳门。' },
  { id: 'hist-03', placePairId: 'place-bp-jia-3-2', period: '明永乐十七年（1419）', name: '崇文门', changeType: '初置', sourceRef: '《京城城门考》', note: '城门建成，内街随门名称崇文门大街。' },
  { id: 'hist-04', placePairId: 'place-bp-jia-3-2', period: '1934 年', name: '崇文门内大街', changeType: '改名', sourceRef: '北平市道路登记册', note: '道路整理后采用今名，原通称仍见于旧图。' },
  { id: 'hist-05', placePairId: 'place-bp-yi-3-1', period: '明万历年间', name: '就日坊', changeType: '初置', sourceRef: '《长安客话》卷二', note: '东单牌楼立坊，为东城地标。' },
  { id: 'hist-06', placePairId: 'place-bp-yi-3-1', period: '民国三年（1914）', name: '东单北大街', changeType: '改名', sourceRef: '京师警察厅道路清册', note: '牌楼拆除后以地段名称替代坊名。' },
  { id: 'hist-07', placePairId: 'place-bp-yi-3-2', period: '元至元四年（1267）', name: '齐化门街', changeType: '初置', sourceRef: '《析津志辑佚》', note: '大都东城墙内主街，东端为齐化门。' },
  { id: 'hist-08', placePairId: 'place-bp-yi-3-2', period: '明正统四年（1439）', name: '朝阳门内大街', changeType: '改名', sourceRef: '《明一统志》卷一', note: '城门更名朝阳门，街名随之更改。' },
  { id: 'hist-09', placePairId: 'place-bp-bing-5-1', period: '金明昌三年（1192）', name: '广利桥', changeType: '初置', sourceRef: '《金史·河渠志》', note: '石桥建成，为中都通往西南要道。' },
  { id: 'hist-10', placePairId: 'place-bp-bing-5-1', period: '清康熙三十七年（1698）', name: '卢沟桥', changeType: '改名', sourceRef: '《畿辅通志》卷三十七', note: '重修后桥名依河定称，绘图沿用卢沟桥。' },
  { id: 'hist-11', placePairId: 'place-bp-bing-5-2', period: '金代', name: '钓鱼台', changeType: '初置', sourceRef: '《日下旧闻考》卷九十五', note: '金人于此筑台垂钓，泊地因台得名。' },
  { id: 'hist-12', placePairId: 'place-bp-bing-5-2', period: '1960 年', name: '玉渊潭', changeType: '改名', sourceRef: '北京市河湖水系资料', note: '疏浚成湖后统一采用玉渊潭名称。' },
  { id: 'hist-13', placePairId: 'place-tj-dong-2-1', period: '清同治九年（1870）', name: '马家口渡', changeType: '初置', sourceRef: '《天津县新志》卷八', note: '海河东岸设义渡，因邻近马家口得名。' },
  { id: 'hist-14', placePairId: 'place-tj-dong-2-1', period: '1985 年', name: '大光明桥', changeType: '迁治', sourceRef: '天津市政桥梁志', note: '新桥在原渡口下游建成，通行功能整体迁移。' },
  { id: 'hist-15', placePairId: 'place-tj-dong-2-2', period: '清康熙年间', name: '盐坨', changeType: '初置', sourceRef: '《长芦盐法志》', note: '长芦盐集散成堆，聚落渐称盐坨。' },
  { id: 'hist-16', placePairId: 'place-tj-dong-2-2', period: '1952 年', name: '建国道一带', changeType: '废置', sourceRef: '天津市街巷名录', note: '旧聚落名称不再作为正式地名，转作历史区域。' },
  { id: 'hist-17', placePairId: 'place-bd-zhong-4-1', period: '宋淳化三年（992）', name: '保塞县署', changeType: '初置', sourceRef: '《宋史·地理志》', note: '县治设于今保定旧城，后屡有移改。' },
  { id: 'hist-18', placePairId: 'place-bd-zhong-4-1', period: '金正大四年（1227）', name: '清苑县署', changeType: '改名', sourceRef: '《金史·地理志》', note: '保州升顺天军，附郭县名沿用清苑。' },
    { id: 'hist-19', placePairId: 'place-bd-zhong-4-2', period: '元太宗十年（1238）', name: '大慈阁', changeType: '初置', sourceRef: '《保定府志》卷十四', note: '真觉禅寺建成，阁前街巷逐渐成市。' },
  { id: 'hist-20', placePairId: 'place-bd-zhong-4-2', period: '2001 年', name: '大慈阁社区', changeType: '改名', sourceRef: '保定市地名志', note: '以古建名称命名社区，旧街名保留为支巷名。' },
  { id: 'hist-21', placePairId: 'place-kf-chengxi-1-1', period: '唐建中二年（781）', name: '汴州西门', changeType: '初置', sourceRef: '《旧唐书·宣武军》', note: '汴州城扩建后设置西城门。' },
  { id: 'hist-22', placePairId: 'place-kf-chengxi-1-1', period: '明洪武元年（1368）', name: '大梁门', changeType: '改名', sourceRef: '《开封府志》卷三', note: '城门重修筑楼，取大梁旧国名称。' },
  { id: 'hist-23', placePairId: 'place-kf-chengxi-1-2', period: '唐建中二年（781）', name: '汴州桥', changeType: '初置', sourceRef: '《汴州图经》残页', note: '桥跨汴河，为州城南向交通节点。' },
  { id: 'hist-24', placePairId: 'place-kf-chengxi-1-2', period: '北宋天圣年间', name: '州桥', changeType: '改名', sourceRef: '《东京梦华录》卷二', note: '御街跨桥通称州桥，天汉桥为正式桥名。' },
]

class GboldmapDatabase extends Dexie {
  sheets!: Table<Sheet, string>
  scans!: Table<ScanItem, string>
  placePairs!: Table<PlacePair, string>
  histories!: Table<NameHistory, string>

  constructor() {
    super('gboldmap-db')

    this.version(1).stores({
      sheets: 'id, code, year, scale, status, series',
      scans: 'id, sheetId, importedAt, quality',
      placePairs: 'id, sheetId, oldName, newName, placeType, certainty',
      histories: 'id, placePairId, period, changeType',
    })

    this.version(2)
      .stores({
        sheets: 'id, code, year, scale, status, series',
        scans: 'id, sheetId, importedAt, quality',
        placePairs: 'id, sheetId, oldName, newName, placeType, certainty',
        histories: 'id, placePairId, period, changeType',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<Sheet, string>('sheets')
          .toCollection()
          .modify((sheet: Sheet & { schemaRev?: number }) => {
            sheet.schemaRev = 2
          })
      })

    this.on('populate', async () => {
      await this.sheets.bulkAdd(sheets)
      await this.scans.bulkAdd(scans)
      await this.placePairs.bulkAdd(placePairs)
      await this.histories.bulkAdd(histories)
    })
  }
}

export const db = new GboldmapDatabase()

/**
 * 剥离 Vue 响应式代理后再写入 IndexedDB。
 * 直接把 reactive 的 Proxy 交给 IndexedDB 会抛 DataCloneError。
 */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createId(prefix: string): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${randomPart}`
}

import { ref } from 'vue'

/* 图鉴各页签共用的纯函数与常量：稀有度、物品类型、描述清洗。
   只放与页面状态无关的东西，各页签自己的数据与筛选仍留在各自组件里。 */

/* 道具描述去掉游戏内富文本标签，保留换行 */
export function cleanDescription(item: any): string {
  return String(item?.desc || item?.effectDesc || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:color|outline|size|[biu])\b[^>]*>/gi, '')
    .trim()
}

export const RARITY_LABELS: Record<number, string> = {
  0: '普通',
  1: '优秀',
  2: '精良',
  3: '稀有',
  4: '史诗',
  5: '传说',
}

/* 稀有度筛选下拉：值为空串表示不筛选 */
export const RARITY_FILTER_OPTIONS = [
  { value: '', label: '全部稀有度' },
  { value: '0', label: '普通' },
  { value: '1', label: '优秀' },
  { value: '2', label: '精良' },
  { value: '3', label: '稀有' },
  { value: '4', label: '史诗' },
  { value: '5', label: '传说' },
]

/* 道具类型下拉（只列实际存在的类型，空格子类型不进列表） */
export const ITEM_TYPE_FILTER_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: '1', label: '特殊道具' },
  { value: '2', label: '货币' },
  { value: '3', label: '经验' },
  { value: '4', label: '农场工具' },
  { value: '7', label: '化肥' },
  { value: '8', label: '宠物' },
  { value: '9', label: '宠物食品' },
  { value: '10', label: '头像框' },
  { value: '11', label: '礼品盒' },
  { value: '12', label: '收藏点' },
  { value: '13', label: '活跃点' },
  { value: '14', label: '解锁卡' },
  { value: '15', label: '高级货币' },
  { value: '16', label: '自选礼包' },
  { value: '17', label: '变异果实' },
  { value: '18', label: '装饰' },
  { value: '19', label: '印章' },
  { value: '23', label: '特殊' },
]

/* 类型标签映射：列表里的类型徽标用，比筛选下拉多出种子/果实两档 */
export const ITEM_TYPE_LABELS: Record<number, string> = {
  1: '特殊道具',
  2: '货币',
  3: '经验',
  4: '农场工具',
  5: '种子',
  6: '果实',
  7: '化肥',
  8: '宠物',
  9: '宠物食品',
  10: '头像框',
  11: '礼品盒',
  12: '收藏点',
  13: '活跃点',
  14: '解锁卡',
  15: '高级货币',
  16: '自选礼包',
  17: '变异果实',
  18: '装饰',
  19: '印章',
  23: '特殊',
}

/* 列表共用的分页状态：页码 + 每页条数（桌面 50 / 移动 30）+ 切片结果 */
export function useCatalogPaging() {
  const currentPage = ref(1)
  const pageSize = 50
  const pageCount = (total: number) => Math.max(1, Math.ceil(total / pageSize))
  const slice = <T>(list: T[]) => {
    const start = (currentPage.value - 1) * pageSize
    return list.slice(start, start + pageSize)
  }
  return { currentPage, pageSize, pageCount, slice }
}

/* 图片加载失败记录：键用商品/种子的唯一 ID */
export function useImageErrors() {
  const imageErrors = ref<Record<string | number, boolean>>({})
  const mark = (id: string | number) => {
    imageErrors.value[id] = true
  }
  return { imageErrors, mark }
}

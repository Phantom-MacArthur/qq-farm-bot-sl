import { computed, ref } from 'vue'

/* 排序按钮的状态机：选定排序字段 + 正序/倒序。
   同一项再点一次即翻转方向，换一项时回到正序——种子/果实/道具共用这一套交互，
   不必每个页签各写一遍 handleXxxSortSelect。 */

export interface SortOption {
  value: string
  label: string
}

export function useSortToggle(initial: string) {
  const sort = ref(initial)
  const dir = ref<'asc' | 'desc'>('asc')

  function select(key: string) {
    if (key === sort.value) {
      dir.value = dir.value === 'asc' ? 'desc' : 'asc'
      return
    }
    sort.value = key
    dir.value = 'asc'
  }

  // 升序 1 / 降序 -1，供比较函数直接相乘
  const direction = computed(() => (dir.value === 'asc' ? 1 : -1))

  return { sort, dir, direction, select }
}

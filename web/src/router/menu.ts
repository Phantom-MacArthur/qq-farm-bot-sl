export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  meta?: {
    fullBleed?: boolean
    gameSpace?: 'ranch'
    ranchSection?: 'ranch' | 'illustrated' | 'mall' | 'friends' | 'activity'
  }
}

const overviewMenuItem: MenuItem = {
  path: '',
  name: 'dashboard',
  label: '概览',
  icon: 'i-carbon-dashboard',
  component: () => import('@/views/Dashboard.vue'),
}

const accountSettingsMenuItem: MenuItem = {
  path: 'settings',
  name: 'Settings',
  label: '账号设置',
  icon: 'i-carbon-settings',
  component: () => import('@/views/Settings.vue'),
}

const systemSettingsMenuItem: MenuItem = {
  path: 'system-settings',
  name: 'SystemSettings',
  label: '系统设置',
  icon: 'i-carbon-settings-services',
  component: () => import('@/views/Settings.vue'),
}

export const menuRoutes: MenuItem[] = [
  overviewMenuItem,
  {
    path: 'farm',
    name: 'farm',
    label: '农场',
    icon: 'i-carbon-sprout',
    component: () => import('@/views/Farm.vue'),
  },
  {
    path: 'pets',
    name: 'pets',
    label: '宠物',
    icon: 'i-carbon-dog-walker',
    component: () => import('@/components/PetPanel.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    label: '图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'activity',
    name: 'activity-center',
    label: '活动',
    icon: 'i-carbon-events',
    component: () => import('@/views/ActivityCenter.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'solar-calendar',
    name: 'solar-calendar',
    label: '节令日历',
    icon: 'i-carbon-calendar',
    component: () => import('@/views/SolarCalendar.vue'),
  },
  {
    path: 'game-mall',
    name: 'game-mall',
    // 页内已经按页签分成特惠/礼包/道具/神秘商人/SVIP 五个子商城，导航项只是入口，不再叫“游戏商城”。
    label: '商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/GameMall.vue'),
  },
  accountSettingsMenuItem,
  systemSettingsMenuItem,
]

export const ranchMenuRoutes: MenuItem[] = [
  { path: 'ranch', name: 'ranch', label: '牧场', icon: 'i-carbon-pet-image-o', component: () => import('@/views/Ranch.vue'), meta: { gameSpace: 'ranch', ranchSection: 'ranch' } },
  { path: 'ranch/illustrated', name: 'ranch-illustrated', label: '图鉴', icon: 'i-carbon-book', component: () => import('@/views/Ranch.vue'), meta: { gameSpace: 'ranch', ranchSection: 'illustrated' } },
  { path: 'ranch/activity', name: 'ranch-activity-center', label: '活动', icon: 'i-carbon-gift', component: () => import('@/views/Ranch.vue'), meta: { gameSpace: 'ranch', ranchSection: 'activity' } },
  { path: 'ranch/friends', name: 'ranch-friends', label: '好友', icon: 'i-carbon-user-multiple', component: () => import('@/views/Ranch.vue'), meta: { gameSpace: 'ranch', ranchSection: 'friends' } },
  { path: 'ranch/game-mall', name: 'ranch-game-mall', label: '游戏商城', icon: 'i-carbon-shopping-cart', component: () => import('@/views/Ranch.vue'), meta: { gameSpace: 'ranch', ranchSection: 'mall' } },
]

export const allMenuRoutes = [...menuRoutes, ...ranchMenuRoutes]
export function getSpaceMenu(inRanch: boolean) {
  return inRanch ? [overviewMenuItem, ...ranchMenuRoutes, accountSettingsMenuItem, systemSettingsMenuItem] : menuRoutes
}

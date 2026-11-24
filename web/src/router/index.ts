import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { allMenuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

// 面板已改为免认证访问：没有登录页，也没有鉴权守卫，打开即进入功能页。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: allMenuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
        meta: route.meta,
      })),
    },
    {
      path: '/mystery-shop',
      name: 'mystery-shop',
      redirect: to => ({ name: 'game-mall', query: { ...to.query, tab: 'mystery' }, hash: to.hash }),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      redirect: { name: 'dashboard' },
    },
  ],
})

router.beforeEach((to, _from) => {
  NProgress.start()

  // 系统设置已从“设置”页标签拆为独立栏目，旧的 tab 链接必须仍能直达新页面
  if (to.name === 'Settings' && ['system', 'user'].includes(String(to.query.tab || '')))
    return { name: 'SystemSettings' }

  return true
})

router.afterEach(() => {
  NProgress.done()
})

export default router

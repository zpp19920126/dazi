import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

// BaseLayout 只依赖 useRoute().path 做菜单高亮，最小路由 mock 即可
const routeMock = vi.hoisted(() => ({ path: '/teacher/dashboard' }))
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRoute: () => routeMock }
})

import BaseLayout from '../BaseLayout.vue'

const menus = [
  { path: '/teacher/dashboard', label: '工作台' },
  { label: '课堂管理', children: [{ path: '/teacher/attendance', label: '开课考勤' }] },
]

describe('BaseLayout 分组菜单', () => {
  it('渲染父项标题与子项', () => {
    const wrapper = mount(BaseLayout, {
      props: { menus },
      // 模板中的 `<router-view /> 依赖 router 插件注册；未安装时解析失败会每次
      // 产生 Vue warn，这里注册一个空渲染的全局同名组件消除噪音（stubs 对未注册组件不生效）
      global: {
        plugins: [createPinia(), ElementPlus],
        components: { 'router-view': { render: () => null } },
      },
    })
    expect(wrapper.text()).toContain('课堂管理')
    expect(wrapper.text()).toContain('开课考勤')
    expect(wrapper.text()).toContain('工作台')
    wrapper.unmount()
  })
})

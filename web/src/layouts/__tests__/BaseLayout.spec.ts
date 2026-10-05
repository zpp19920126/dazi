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
      global: { plugins: [createPinia(), ElementPlus] },
      stubs: { RouterView: true },
    })
    expect(wrapper.text()).toContain('课堂管理')
    expect(wrapper.text()).toContain('开课考勤')
    expect(wrapper.text()).toContain('工作台')
    wrapper.unmount()
  })
})

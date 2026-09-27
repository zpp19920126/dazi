import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/utils/request', () => ({ default: { get: getMock, post: postMock } }))

// useRoute 的 params 动态可变：无参 → 自由练习；带 taskId → 任务练习
const routeMock = vi.hoisted(() => ({ params: {} as Record<string, string | undefined> }))
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRoute: () => routeMock }
})

import Typing from '../student/Typing.vue'

function mountView() {
  return mount(Typing, { global: { plugins: [createPinia(), ElementPlus] } })
}

describe('Typing.vue 学生打字练习页', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockClear()
    routeMock.params = {}
  })

  it('自由练习：选择文章后渲染与 target 等长的字符 span', async () => {
    getMock.mockResolvedValue({
      list: [{ id: 1, title: 'T1', language: 'en', difficulty: 'easy', charCount: 5, content: 'hello' }],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(getMock).toHaveBeenCalledWith('/texts', { params: { page: 1, pageSize: 20 } })
    expect(wrapper.find('[data-testid="text-list"]').exists()).toBe(true)

    await wrapper.find('[data-testid="text-list"] .el-button').trigger('click')
    await flushPromises()

    const spans = wrapper.findAll('[data-testid="article"] span')
    expect(spans).toHaveLength(5)
    expect(wrapper.find('[data-testid="status-bar"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('任务练习：路由带 taskId 时加载任务并渲染文章字符', async () => {
    routeMock.params = { taskId: '5' }
    getMock.mockResolvedValue({
      active: [
        {
          id: 5,
          title: '任务A',
          mode: 'article',
          durationSeconds: null,
          minSpeed: 10,
          minAccuracy: 90,
          deadline: null,
          status: 'published',
          text: { id: 1, title: 'T1', language: 'en', difficulty: 'easy', charCount: 4, content: 'wxyz' },
        },
      ],
      history: [],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(getMock).toHaveBeenCalledWith('/tasks')

    const spans = wrapper.findAll('[data-testid="article"] span')
    expect(spans).toHaveLength(4)
    expect(wrapper.find('[data-testid="status-bar"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/request', () => ({ default: { get: getMock, post: vi.fn(async () => ({})) } }))

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

import MyTasks from '../student/MyTasks.vue'

const activeTasks = [
  {
    id: 1,
    title: '任务一',
    mode: 'article',
    durationSeconds: null,
    minSpeed: 20,
    minAccuracy: 95,
    deadline: '2026-10-01T00:00:00.000Z',
    className: '一班',
    text: { id: 1, title: 'A1', language: 'en', difficulty: 'easy', charCount: 10 },
  },
  {
    id: 2,
    title: '任务二',
    mode: 'time',
    durationSeconds: 60,
    minSpeed: 10,
    minAccuracy: 90,
    deadline: null,
    className: '一班',
    text: { id: 2, title: 'A2', language: 'zh', difficulty: 'easy', charCount: 20 },
  },
]
const historyTasks = [
  {
    id: 3,
    title: '任务三',
    mode: 'article',
    durationSeconds: null,
    minSpeed: 20,
    minAccuracy: 95,
    deadline: '2026-09-01T00:00:00.000Z',
    className: '一班',
    text: { id: 3, title: 'A3', language: 'en', difficulty: 'easy', charCount: 8 },
    myRecord: { speed: '35.50', accuracy: '98.20', isPassed: true, createdAt: '2026-09-26T10:00:00.000Z' },
  },
]

describe('MyTasks.vue 学生任务列表页', () => {
  beforeEach(() => {
    getMock.mockReset()
    pushMock.mockClear()
  })

  it('渲染进行中卡片与历史表格，点击去练习跳转', async () => {
    getMock.mockResolvedValue({ active: activeTasks, history: historyTasks })
    const wrapper = mount(MyTasks, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    expect(getMock).toHaveBeenCalledWith('/tasks')
    expect(wrapper.findAll('[data-testid="active-cards"] .el-card')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="history-table"] .el-table__row')).toHaveLength(1)

    await wrapper.find('[data-testid="task-card-1"] .el-button').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/student/typing/1')
    wrapper.unmount()
  })

  it('无任务时展示空状态', async () => {
    getMock.mockResolvedValue({ active: [], history: [] })
    const wrapper = mount(MyTasks, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="active-cards"] .el-card')).toHaveLength(0)
    expect(wrapper.find('.el-empty').exists()).toBe(true)
    wrapper.unmount()
  })
})

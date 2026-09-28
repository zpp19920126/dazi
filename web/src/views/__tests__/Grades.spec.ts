import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/request', () => ({ default: { get: getMock } }))

import Grades from '../teacher/Grades.vue'

const tasks = {
  list: [{ id: 1, title: '期末测试', className: '一班' }],
  total: 1,
}

// Decimal 经 JSON 序列化为字符串
const grades = {
  list: [
    {
      id: 11,
      user: { id: 1, realName: '张三', username: 's001' },
      speed: '120.45',
      accuracy: '98.20',
      durationSeconds: 180,
      isPassed: true,
      isSuspicious: true,
      createdAt: '2026-09-27T10:00:00.000Z',
    },
    {
      id: 12,
      user: { id: 2, realName: '李四', username: 's002' },
      speed: '80.00',
      accuracy: '90.00',
      durationSeconds: 200,
      isPassed: false,
      isSuspicious: false,
      createdAt: '2026-09-27T10:05:00.000Z',
    },
  ],
  total: 2,
  stats: { avgSpeed: 100.23, avgAccuracy: 94.1, passedRate: 50 },
}

describe('Grades.vue 教师成绩查询页', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  async function openWithGrades() {
    getMock.mockResolvedValueOnce(tasks).mockResolvedValueOnce(grades)
    const wrapper = mount(Grades, {
      global: { plugins: [createPinia(), ElementPlus] },
    })
    await flushPromises()
    // 选择任务触发成绩加载
    await wrapper.findComponent({ name: 'ElSelect' }).setValue(1)
    await flushPromises()
    return wrapper
  }

  it('选择任务后加载成绩单：统计卡 + 可疑行 danger 高亮', async () => {
    const wrapper = await openWithGrades()

    expect(getMock).toHaveBeenNthCalledWith(2, '/tasks/1/grades', {
      params: { page: 1, pageSize: 500 },
    })
    expect(wrapper.find('[data-testid="grades-stats"]').text()).toContain('100.23')
    const rows = wrapper.findAll('[data-testid="grades-table"] tbody tr')
    expect(rows).toHaveLength(2)
    // 张三 isSuspicious → 行高亮
    expect(wrapper.find('tr.suspicious-row').text()).toContain('张三')
    wrapper.unmount()
  })

  it('点击导出 CSV 以 blob 方式请求并触发下载', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    )
    const wrapper = await openWithGrades()

    getMock.mockResolvedValueOnce(new Blob(['name,speed\n张三,120']))
    await wrapper.find('[data-testid="export-csv"]').trigger('click')
    await flushPromises()

    expect(getMock).toHaveBeenNthCalledWith(3, '/tasks/1/grades', {
      params: { export: 'csv' },
      responseType: 'blob',
    })
    expect(createObjectURL).toHaveBeenCalled()
    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})

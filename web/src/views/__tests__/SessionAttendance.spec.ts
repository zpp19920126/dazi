import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('@/utils/request', () => ({ default: mocks }))

import SessionAttendance from '../teacher/SessionAttendance.vue'

const attendanceRow = {
  id: 1,
  userId: 9,
  realName: '张三',
  username: 's009',
  checkInAt: '2026-10-05T06:06:00.000Z',
  status: 'present',
  corrected: false,
  note: null,
  seated: true,
}

const classesPayload = { list: [{ id: 3, name: '三年2班', studentCount: 1 }], total: 1 }

describe('开课考勤页', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
  })

  it('无 open 课次时显示开课按钮', async () => {
    // 组件挂载调用顺序：GET /classes → GET /sessions（无 open 课次则不再拉名单）
    mocks.get
      .mockResolvedValueOnce(classesPayload)
      .mockResolvedValueOnce({ list: [], total: 0 })
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(mocks.get).toHaveBeenNthCalledWith(2, '/sessions', {
      params: { classId: 3, page: 1, pageSize: 50 },
    })
    expect(wrapper.text()).toContain('开 课')
    wrapper.unmount() // 清 30s 自刷定时器，避免悬挂
  })

  it('存在 open 课次时显示考勤表与结课', async () => {
    mocks.get
      .mockResolvedValueOnce(classesPayload)
      .mockResolvedValueOnce({
        list: [
          {
            id: 7,
            classId: 3,
            status: 'open',
            period: '第一节',
            startedAt: new Date().toISOString(),
            endedAt: null,
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce([attendanceRow])
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(mocks.get).toHaveBeenNthCalledWith(3, '/sessions/7/attendance')
    expect(wrapper.find('[data-testid="attendance-table"]').text()).toContain('张三')
    expect(wrapper.text()).toContain('结 课')
    wrapper.unmount()
  })

  it('开课超过4小时显示已上时长与超4小时提醒', async () => {
    const longAgo = new Date(Date.now() - 5 * 3_600_000).toISOString()
    mocks.get
      .mockResolvedValueOnce(classesPayload)
      .mockResolvedValueOnce({
        list: [{ id: 7, classId: 3, status: 'open', period: '第一节', startedAt: longAgo, endedAt: null }],
        total: 1,
      })
      .mockResolvedValueOnce([])
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('已上 5 小时')
    expect(wrapper.text()).toContain('已超4小时')
    wrapper.unmount()
  })
})

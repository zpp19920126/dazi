import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { type MessageBoxData } from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))

import HomeworkList from '../teacher/HomeworkList.vue'

const classesPayload = { list: [{ id: 3, name: '三年2班', studentCount: 2 }], total: 1 }
const homeworksPayload = {
  list: [
    {
      id: 7,
      title: '第三课作业',
      classId: 3,
      className: '三年2班',
      dueAt: '2026-10-06T10:00:00.000Z',
      status: 'published',
      allowAttachment: true,
      submissionCount: 1,
      studentCount: 2,
      gradedCount: 0,
    },
  ],
  total: 1,
}

describe('教师作业管理页', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    // 兜底：布置/截止成功后的组件内部 refresh 再次 GET /homeworks 时避免返回 undefined
    mocks.get.mockResolvedValue({ list: [], total: 0 })
  })

  it('加载班级与作业列表并渲染统计', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('第三课作业')
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('1/2')
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('待批改 1')
    wrapper.unmount()
  })

  it('布置作业提交 POST /homeworks', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    mocks.post.mockResolvedValueOnce({ id: 8 })
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.find('[data-testid="open-create"]').trigger('click')
    await flushPromises()
    await wrapper.find('input[data-testid="form-title"]').setValue('新作业')
    const due = new Date(Date.now() + 3600_000).toISOString()
    ;(wrapper.vm as unknown as { create: { dueAt: string } }).create.dueAt = due
    await wrapper.find('[data-testid="form-submit"]').trigger('click')
    await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith(
      '/homeworks',
      expect.objectContaining({ classId: 3, title: '新作业' }),
    )
    wrapper.unmount()
  })

  it('截止按钮二次确认后 PATCH closed', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    mocks.patch.mockResolvedValueOnce({ id: 7, status: 'closed' })
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const { ElMessageBox } = await import('element-plus')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as MessageBoxData)
    await wrapper.find('[data-testid="close-hw-7"]').trigger('click')
    await flushPromises()
    expect(mocks.patch).toHaveBeenCalledWith('/homeworks/7', { status: 'closed' })
    wrapper.unmount()
  })

  it('状态筛选透传 classId/status 参数', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    ;(wrapper.vm as unknown as { filterStatus: string }).filterStatus = 'closed'
    const refresh = (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh
    await refresh()
    expect(mocks.get).toHaveBeenLastCalledWith('/homeworks', {
      params: { page: 1, pageSize: 20, classId: undefined, status: 'closed' },
    })
    wrapper.unmount()
  })
})

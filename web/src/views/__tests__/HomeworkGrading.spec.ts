import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))

// 路由参数 hwId=7：mock useRoute 的 params，useRouter 仅占位
const routeMock = vi.hoisted(() => ({ params: { id: '7' } }))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn() }),
}))

import HomeworkGrading from '../teacher/HomeworkGrading.vue'

const detailPayload = {
  homework: {
    id: 7,
    title: '第三课作业',
    content: '完成第三课录入练习并保存截图',
    dueAt: '2026-10-05T10:00:00.000Z',
    status: 'closed',
  },
  studentCount: 2,
  submissions: [
    {
      id: 21,
      userId: 9,
      realName: '张三',
      username: 's009',
      textContent: '第一版正文',
      submittedAt: '2026-10-05T09:00:00.000Z',
      isLate: false,
      score: '92.50',
      teacherComment: '很好',
      files: [{ id: 31, originalName: '截图.pdf', sizeBytes: 1024 }],
    },
    {
      id: 22,
      userId: 10,
      realName: '李四',
      username: 's010',
      textContent: '迟交正文',
      submittedAt: '2026-10-05T11:00:00.000Z',
      isLate: true,
      score: null,
      teacherComment: null,
      files: [],
    },
  ],
  mySubmission: null,
}

describe('教师作业批改页', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    // 兜底：保存批改后的重新 GET detail、PATCH 返回值都走 mockResolvedValue，
    // 避免 Once 队列耗尽返回 undefined
    mocks.get.mockResolvedValue(detailPayload)
    mocks.patch.mockResolvedValue({})
  })

  it('挂载后拉取详情并渲染头部统计与提交列表', async () => {
    const wrapper = mount(HomeworkGrading, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith('/homeworks/7')
    expect(wrapper.text()).toContain('第三课作业 · 2 人 · 已交 2 · 未交 0')
    // Ruling P-5：批改页须显示作业要求与截止时间
    const info = wrapper.find('[data-testid="homework-info"]')
    expect(info.exists()).toBe(true)
    expect(info.text()).toContain('完成第三课录入练习并保存截图')
    expect(info.text()).toContain('截止时间')
    const list = wrapper.find('[data-testid="submission-list"]')
    expect(list.text()).toContain('张三')
    expect(list.text()).toContain('李四')
    wrapper.unmount()
  })

  it('选择迟交未批改提交保存批改并重新拉取详情', async () => {
    const wrapper = mount(HomeworkGrading, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="pick-22"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="grade-panel"]').text()).toContain('迟交正文')

    await wrapper.find('[data-testid="grade-score"] input').setValue('88')
    await wrapper.find('[data-testid="grade-save"]').trigger('click')
    await flushPromises()

    expect(mocks.patch).toHaveBeenCalledWith('/homework/submissions/22/grade', {
      score: 88,
      comment: undefined,
    })
    // 保存后组件重新 GET 详情：挂载 1 次 + 保存后 1 次
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/homeworks/7')
    wrapper.unmount()
  })

  it('选择已批改提交回显分数点评与附件下载入口', async () => {
    const wrapper = mount(HomeworkGrading, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="pick-21"]').trigger('click')
    await flushPromises()

    const scoreInput = wrapper.find('[data-testid="grade-score"] input')
    expect((scoreInput.element as HTMLInputElement).value).toBe('92.5')
    const commentArea = wrapper.find('textarea[data-testid="grade-comment"]')
    expect((commentArea.element as HTMLTextAreaElement).value).toBe('很好')
    expect(wrapper.find('[data-testid="file-dl-31"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

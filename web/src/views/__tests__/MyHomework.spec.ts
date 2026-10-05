import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))

import MyHomework from '../student/MyHomework.vue'

const futureDue = new Date(Date.now() + 2 * 86_400_000).toISOString()
const pastDue = new Date(Date.now() - 86_400_000).toISOString()

// Task 4 学生列表行形状：作业字段 + 嵌套 klass:{name} + mySubmission | null
// （教师/管理员分支才是扁平 className；学生分支是 { ...homework, mySubmission } 展开）
const rowsPayload = {
  list: [
    {
      id: 1,
      classId: 3,
      title: '进行中的作业',
      content: '抄写课文',
      dueAt: futureDue,
      status: 'published',
      allowAttachment: true,
      createdAt: pastDue,
      klass: { name: '三年2班' },
      mySubmission: null,
    },
    {
      id: 2,
      classId: 3,
      title: '已交待批改的作业',
      content: 'c2',
      dueAt: futureDue,
      status: 'published',
      allowAttachment: false,
      createdAt: pastDue,
      klass: { name: '三年2班' },
      mySubmission: {
        id: 21,
        textContent: '我的答案',
        submittedAt: pastDue,
        isLate: false,
        score: null,
        teacherComment: null,
      },
    },
    {
      id: 3,
      classId: 3,
      title: '已批改的作业',
      content: 'c3',
      dueAt: pastDue,
      status: 'closed',
      allowAttachment: false,
      createdAt: pastDue,
      klass: { name: '三年2班' },
      mySubmission: {
        id: 22,
        textContent: '我的答案3',
        submittedAt: pastDue,
        isLate: true,
        score: '92.50',
        teacherComment: '很好',
      },
    },
    {
      id: 4,
      classId: 3,
      title: '已截止未交的作业',
      content: 'c4',
      dueAt: pastDue,
      status: 'closed',
      allowAttachment: false,
      createdAt: pastDue,
      klass: { name: '三年2班' },
      mySubmission: null,
    },
  ],
  total: 4,
}

describe('学生我的作业列表', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.push.mockReset()
    // 兜底：避免组件内部再次 load 时 Once 队列耗尽返回 undefined
    mocks.get.mockResolvedValue(rowsPayload)
  })

  it('渲染四种状态', async () => {
    const wrapper = mount(MyHomework, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith('/homeworks', { params: { page: 1, pageSize: 50 } })

    const card1 = wrapper.find('[data-testid="hw-card-1"]')
    expect(card1.text()).toContain('进行中的作业')
    expect(card1.text()).toContain('进行中')
    expect(card1.text()).toContain('剩余')

    const card2 = wrapper.find('[data-testid="hw-card-2"]')
    expect(card2.text()).toContain('已提交·待批改')

    const card3 = wrapper.find('[data-testid="hw-card-3"]')
    expect(card3.text()).toContain('92.5')
    expect(card3.text()).toContain('很好')

    const card4 = wrapper.find('[data-testid="hw-card-4"]')
    expect(card4.text()).toContain('已截止·未提交')
    expect(card4.find('.el-tag').classes()).toContain('el-tag--danger')

    wrapper.unmount()
  })

  it('点击卡片进入提交页', async () => {
    const wrapper = mount(MyHomework, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="hw-card-2"]').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith('/student/homework/2')

    wrapper.unmount()
  })
})

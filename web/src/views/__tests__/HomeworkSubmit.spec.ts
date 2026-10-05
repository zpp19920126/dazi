import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), push: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))
// 路由参数 hwId=7：mock useRoute 的 params；useRouter 断言返回按钮
const routeMock = vi.hoisted(() => ({ params: { id: '7' } }))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: mocks.push }),
}))

import HomeworkSubmit from '../student/HomeworkSubmit.vue'

const futureDue = new Date(Date.now() + 86_400_000).toISOString()

// Task 4 detail 学生分支形状：{ homework, mySubmission | null }
function detailOf(overrides: {
  allowAttachment?: boolean
  mySubmission?: Record<string, unknown> | null
} = {}) {
  return {
    homework: {
      id: 7,
      classId: 3,
      title: '第三课作业',
      content: '抄写课文并写感想\n第二行要求',
      dueAt: futureDue,
      status: 'published',
      allowAttachment: overrides.allowAttachment ?? false,
    },
    mySubmission: overrides.mySubmission ?? null,
  }
}

describe('学生作业提交页', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.push.mockReset()
    // 兜底：提交成功后的组件内部 reload 避免返回 undefined
    mocks.get.mockResolvedValue(detailOf())
    mocks.post.mockResolvedValue({ id: 31, homeworkId: 7, submittedAt: futureDue, isLate: false })
  })

  it('不允许附件时隐藏文件输入且无最近提交区块，pre 区显示要求原文', async () => {
    const wrapper = mount(HomeworkSubmit, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith('/homeworks/7')
    expect(wrapper.find('[data-testid="file-input"]').exists()).toBe(false)
    expect(wrapper.find('pre').text()).toContain('抄写课文并写感想')
    expect(wrapper.find('[data-testid="last-submission"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('允许附件时文件输入存在且可多选', async () => {
    mocks.get.mockResolvedValueOnce(detailOf({ allowAttachment: true }))
    const wrapper = mount(HomeworkSubmit, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const input = wrapper.find('[data-testid="file-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).multiple).toBe(true)
    wrapper.unmount()
  })

  it('文本提交走 multipart FormData', async () => {
    const wrapper = mount(HomeworkSubmit, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('textarea[data-testid="content-input"]').setValue('我的答案')
    await wrapper.find('[data-testid="send-submit"]').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledTimes(1)
    const [url, fd] = mocks.post.mock.calls[0]
    expect(url).toBe('/homeworks/7/submissions')
    expect(fd).toBeInstanceOf(FormData)
    expect(fd.get('textContent')).toBe('我的答案')
    wrapper.unmount()
  })

  it('已有提交时显示重交提示', async () => {
    mocks.get.mockResolvedValueOnce(
      detailOf({
        mySubmission: {
          id: 21,
          textContent: '上次的答案',
          submittedAt: futureDue,
          isLate: false,
          score: null,
          teacherComment: null,
          files: [],
        },
      }),
    )
    const wrapper = mount(HomeworkSubmit, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('截止前可重交，以最后一次为准')
    expect(wrapper.find('[data-testid="last-submission"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

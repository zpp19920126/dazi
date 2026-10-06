import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))

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
  studentCount: 3,
  submissions: [],
  mySubmission: null,
}

// GET /homeworks/7/grades?pageSize=100 契约（T-G1 后端增补字段后的行形状）
const gradesPayload = {
  list: [
    {
      userId: 9,
      realName: '张三',
      username: 's009',
      submittedAt: '2026-10-05T09:00:00.000Z',
      state: '按时',
      score: 92.5,
      teacherComment: '很好',
      submissionId: 21,
      textContent: '第一版正文',
      files: [{ id: 31, originalName: '截图.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 }],
    },
    {
      userId: 10,
      realName: '李四',
      username: 's010',
      submittedAt: '2026-10-05T11:00:00.000Z',
      state: '迟交',
      score: null,
      teacherComment: null,
      submissionId: 22,
      textContent: '迟交正文',
      files: [{ id: 32, originalName: '报告.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }],
    },
    {
      userId: 11,
      realName: '王五',
      username: 's011',
      submittedAt: null,
      state: '未交',
      score: null,
      teacherComment: null,
      submissionId: null,
      textContent: null,
      files: [],
    },
  ],
  total: 3,
  stats: { submitted: 2, graded: 1, late: 1, unsubmitted: 1 },
}

const clone = (v: unknown) => JSON.parse(JSON.stringify(v))

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.patch.mockReset()
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/homeworks/7') return clone(detailPayload)
    if (url === '/homeworks/7/grades?pageSize=100') return clone(gradesPayload)
    if (url.startsWith('/files/')) return new Blob(['x'], { type: 'image/jpeg' })
    return undefined
  })
  mocks.patch.mockResolvedValue({})
  window.URL.createObjectURL = vi.fn(() => 'blob:mock')
  window.URL.revokeObjectURL = vi.fn()
})

function mountPage() {
  return mount(HomeworkGrading, { global: { plugins: [ElementPlus] }, attachTo: document.body })
}

describe('教师批改全班表格页', () => {
  it('挂载拉取详情+全班名单：3人同屏含未交，头部统计与P-5信息条', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith('/homeworks/7')
    expect(mocks.get).toHaveBeenCalledWith('/homeworks/7/grades?pageSize=100')
    const text = wrapper.text()
    expect(text).toContain('张三')
    expect(text).toContain('李四')
    expect(text).toContain('王五')
    expect(text).toContain('未交 1')
    const info = wrapper.find('[data-testid="homework-info"]')
    expect(info.exists()).toBe(true)
    expect(info.text()).toContain('完成第三课录入练习并保存截图')
    expect(info.text()).toContain('截止时间')
    wrapper.unmount()
  })

  it('未交学生行：分数与点评输入禁用', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const scoreInput = wrapper.find('[data-testid="score-11"] input')
    expect((scoreInput.element as HTMLInputElement).disabled).toBe(true)
    const commentArea = wrapper.find('textarea[data-testid="comment-11"]')
    expect((commentArea.element as HTMLTextAreaElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('已批行回显92.5；改95失焦→PATCH submissions/21 {score:95,comment:很好}；无改动再失焦不发请求', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const scoreInput = wrapper.find('[data-testid="score-9"] input')
    expect((scoreInput.element as HTMLInputElement).value).toBe('92.5')

    await scoreInput.setValue('95')
    await scoreInput.trigger('blur')
    await flushPromises()
    expect(mocks.patch).toHaveBeenCalledWith('/homework/submissions/21/grade', {
      score: 95,
      comment: '很好',
    })

    mocks.patch.mockClear()
    await scoreInput.trigger('blur')
    await flushPromises()
    expect(mocks.patch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('点评失焦随分数一并保存（服务端点评单字段为空时省略即清空）', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('textarea[data-testid="comment-9"]').setValue('很棒')
    await wrapper.find('textarea[data-testid="comment-9"]').trigger('blur')
    await flushPromises()
    expect(mocks.patch).toHaveBeenCalledWith('/homework/submissions/21/grade', {
      score: 92.5,
      comment: '很棒',
    })
    wrapper.unmount()
  })

  it('图片附件走鉴权下载拉blob并渲染缩略图；非图片仅显示文件名可下载', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith(
      '/files/31/download',
      expect.objectContaining({ responseType: 'blob' }),
    )
    const thumb = wrapper.find('[data-testid="thumb-31"]')
    expect(thumb.exists()).toBe(true)
    expect(thumb.find('img').attributes('src')).toBe('blob:mock')

    // 非图片不拉缩略图，点击走下载
    expect(mocks.get).not.toHaveBeenCalledWith(
      '/files/32/download',
      expect.objectContaining({ responseType: 'blob' }),
    )
    await wrapper.find('[data-testid="file-dl-32"]').trigger('click')
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledWith(
      '/files/32/download',
      expect.objectContaining({ responseType: 'blob' }),
    )
    wrapper.unmount()
  })

  it('30秒轮询刷新名单；输入中的未保存格子不被覆盖', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountPage()
      await flushPromises()
      const gradesCalls = () =>
        mocks.get.mock.calls.filter(([u]) => u === '/homeworks/7/grades?pageSize=100').length
      expect(gradesCalls()).toBe(1)

      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()
      expect(gradesCalls()).toBe(2)

      const comment = wrapper.find('textarea[data-testid="comment-9"]')
      await comment.setValue('草稿点评')
      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()
      expect(gradesCalls()).toBe(3)
      // 脏行合并：服务端值不回写正在编辑的格子
      expect((comment.element as HTMLTextAreaElement).value).toBe('草稿点评')

      // 焦点在表格内时整轮跳过，不发请求
      const scoreInputEl = wrapper.find('[data-testid="score-9"] input')
        .element as HTMLInputElement
      scoreInputEl.focus()
      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()
      expect(gradesCalls()).toBe(3)
      scoreInputEl.blur()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('行内查看详情弹窗：完整文本+全部附件（图片大图/文件可下载）；未交行按钮禁用', async () => {
    const wrapper = mount(HomeworkGrading, {
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
      attachTo: document.body,
    })
    await flushPromises()

    expect((wrapper.find('[data-testid="detail-11"]').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="detail-9"]').trigger('click')
    await flushPromises()
    const dlg = wrapper.find('[data-testid="detail-dialog"]')
    expect(dlg.exists()).toBe(true)
    expect(dlg.text()).toContain('张三')
    expect(dlg.text()).toContain('第一版正文')
    expect(dlg.find('[data-testid="dthumb-31"]').exists()).toBe(true)

    // 李四：pdf 走弹窗内下载按钮
    await wrapper.find('[data-testid="detail-10"]').trigger('click')
    await flushPromises()
    const dlg2 = wrapper.find('[data-testid="detail-dialog"]')
    expect(dlg2.text()).toContain('迟交正文')
    expect(dlg2.find('[data-testid="dfile-dl-32"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('保存在途时再次编辑不丢失：首个 PATCH 成功后自动补发第二个 PATCH', async () => {
    let resolveFirst!: (v: unknown) => void
    mocks.patch.mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
    const wrapper = mountPage()
    await flushPromises()

    const comment = wrapper.find('textarea[data-testid="comment-9"]')
    await comment.setValue('第一版点评')
    await comment.trigger('blur') // PATCH #1 挂起（savingIds 拦截后续保存）
    await comment.setValue('第二版点评') // 飞行期间继续编辑
    resolveFirst({})
    await flushPromises() // 成功 → snap 记已发送值 → finally 补发

    expect(mocks.patch).toHaveBeenCalledTimes(2)
    expect(mocks.patch).toHaveBeenLastCalledWith('/homework/submissions/21/grade', {
      score: 92.5,
      comment: '第二版点评',
    })
    wrapper.unmount()
  })

  it('保存成功后，发起于保存前的迟归轮询不回写旧成绩', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountPage()
      await flushPromises()

      // 拦下 tick 发起的 grades GET，让它在保存之后才迟到返回
      let resolveGrades!: (v: unknown) => void
      const defaultGet = mocks.get.getMockImplementation()!
      mocks.get.mockImplementationOnce((url: string) => {
        if (url === '/homeworks/7/grades?pageSize=100') {
          return new Promise((res) => (resolveGrades = res))
        }
        return defaultGet(url)
      })
      await vi.advanceTimersByTimeAsync(30_000) // tick → grades 请求在途（数据为旧值）

      const comment = wrapper.find('textarea[data-testid="comment-9"]')
      await comment.setValue('最终点评')
      await comment.trigger('blur')
      await flushPromises() // PATCH 成功，lastSavedAt 晚于轮询发起

      resolveGrades(clone(gradesPayload)) // 迟到的旧响应：teacherComment '很好'
      await flushPromises()

      expect((comment.element as HTMLTextAreaElement).value).toBe('最终点评')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('轮询后行消失：已打开的详情弹窗自动关闭', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(HomeworkGrading, {
        global: { plugins: [ElementPlus], stubs: { teleport: true } },
        attachTo: document.body,
      })
      await flushPromises()
      await wrapper.find('[data-testid="detail-9"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="detail-dialog"]').exists()).toBe(true)

      const shrunk = clone(gradesPayload)
      shrunk.list = shrunk.list.filter((r: { userId: number }) => r.userId !== 9)
      const defaultGet = mocks.get.getMockImplementation()!
      mocks.get.mockImplementationOnce((url: string) =>
        url === '/homeworks/7/grades?pageSize=100' ? Promise.resolve(shrunk) : defaultGet(url),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()

      expect(wrapper.find('[data-testid="detail-dialog"]').exists()).toBe(false)
      // 弹窗本体（overlay）也必须真正关闭，而非留下空白对话框
      const overlay = wrapper.find('.el-overlay')
      expect(overlay.exists() ? overlay.attributes('style') ?? '' : '').toContain('display: none')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

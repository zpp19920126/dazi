import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/request', () => ({ default: { get: getMock, post: postMock } }))

import TaskCreate from '../teacher/TaskCreate.vue'

const classes = {
  list: [{ id: 1, name: '一班', studentCount: 2 }],
  total: 1,
}
const texts = {
  list: [{ id: 5, title: 'My Best Friend', language: 'en', charCount: 748 }],
  total: 1,
}

describe('TaskCreate.vue 教师发布任务弹窗', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  async function openDialog() {
    getMock.mockResolvedValueOnce(classes).mockResolvedValueOnce(texts)
    const wrapper = mount(TaskCreate, {
      props: { modelValue: false },
      global: { plugins: [createPinia(), ElementPlus] },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  async function fillBaseForm(wrapper: Awaited<ReturnType<typeof openDialog>>) {
    await wrapper.find('input[data-testid="task-title"]').setValue('期末测试')
    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    await selects[0].setValue(1) // 班级
    await selects[1].setValue(5) // 文章
  }

  it('time 模式未填时长时提交被拦截，不发起请求', async () => {
    const wrapper = await openDialog()
    await fillBaseForm(wrapper)

    await wrapper.findComponent({ name: 'ElRadioGroup' }).setValue('time')
    await flushPromises()
    await wrapper.find('[data-testid="task-submit"]').trigger('click')
    await flushPromises()

    expect(postMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('填写完整后提交成功并触发 created', async () => {
    postMock.mockResolvedValue({ id: 9 })
    const wrapper = await openDialog()
    await fillBaseForm(wrapper)

    await wrapper.findComponent({ name: 'ElRadioGroup' }).setValue('time')
    await flushPromises()
    // 表单顺序中第一个数字输入框为限时秒数
    await wrapper.findAllComponents({ name: 'ElInputNumber' })[0].setValue(60)
    await wrapper.findComponent({ name: 'ElDatePicker' }).setValue('2026-12-31 10:00:00')

    await wrapper.find('[data-testid="task-submit"]').trigger('click')
    await flushPromises()

    expect(postMock).toHaveBeenCalledTimes(1)
    const [url, payload] = postMock.mock.calls[0]
    expect(url).toBe('/tasks')
    expect(payload).toMatchObject({
      title: '期末测试',
      classId: 1,
      textId: 5,
      mode: 'time',
      durationSeconds: 60,
      minSpeed: 20,
      minAccuracy: 95,
    })
    expect(new Date(payload.deadline as string).toString()).not.toBe('Invalid Date')
    expect(wrapper.emitted('created')).toHaveLength(1)
    wrapper.unmount()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ChangePassword from '../ChangePassword.vue'
import { useAuthStore } from '@/stores/auth'
import { TOKEN_KEY, USER_KEY } from '@/utils/request'

const { postMock, pushMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  pushMock: vi.fn(),
}))

// mock request 层（改密默认成功），保留 TOKEN_KEY/USER_KEY 供 store 持久化使用
vi.mock('@/utils/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/request')>()
  return { ...actual, default: { post: postMock } }
})

// mock useRouter，捕获跳转目标
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

const mustChangeUser = {
  id: 2,
  username: 's001',
  realName: '张三',
  role: 'student' as const,
  classId: 1,
  mustChangePassword: true,
}

async function mountPage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ChangePassword, { global: { plugins: [pinia, ElementPlus] } })
  await flushPromises()
  return wrapper
}

async function fillAndSubmit(
  wrapper: Awaited<ReturnType<typeof mountPage>>,
  values: [oldPassword: string, newPassword: string, confirmPassword: string],
) {
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue(values[0])
  await inputs[1]!.setValue(values[1])
  await inputs[2]!.setValue(values[2])
  await wrapper.find('.submit-button').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  postMock.mockReset()
  postMock.mockResolvedValue(null)
  pushMock.mockClear()
  localStorage.clear()
  localStorage.setItem(TOKEN_KEY, 'test-token')
  localStorage.setItem(USER_KEY, JSON.stringify(mustChangeUser))
})

describe('ChangePassword.vue', () => {
  it('空表单提交不发送请求', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.submit-button').trigger('click')
    await flushPromises()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('两次新密码不一致时不发送请求', async () => {
    const wrapper = await mountPage()
    await fillAndSubmit(wrapper, ['old123', 'newpass1', 'newpass2'])
    expect(postMock).not.toHaveBeenCalled()
  })

  it('修改成功 → 请求参数正确、清除 store 强制改密标记并持久化、跳角色首页', async () => {
    const wrapper = await mountPage()
    await fillAndSubmit(wrapper, ['old123', 'newpass123', 'newpass123'])
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith('/auth/change-password', {
      oldPassword: 'old123',
      newPassword: 'newpass123',
    })
    const auth = useAuthStore()
    expect(auth.user?.mustChangePassword).toBe(false)
    const persisted = JSON.parse(localStorage.getItem(USER_KEY) ?? '{}')
    expect(persisted.mustChangePassword).toBe(false)
    expect(pushMock).toHaveBeenCalledWith('/student/tasks')
  })
})

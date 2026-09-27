import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Login from '../Login.vue'
import { useAuthStore, type UserInfo } from '@/stores/auth'

// mock vue-router 的 useRouter，捕获 push 调用目标
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: pushMock }) }
})

function makeUser(role: UserInfo['role']): UserInfo {
  return { id: 1, username: 'u001', realName: '测试用户', role, classId: null, mustChangePassword: false }
}

async function mountLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Login, { global: { plugins: [pinia, ElementPlus] } })
  const store = useAuthStore()
  const loginSpy = vi.spyOn(store, 'login')
  await flushPromises()
  return { wrapper, loginSpy }
}

async function fillAndSubmit(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper'], username: string, password: string) {
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue(username)
  await inputs[1]!.setValue(password)
  await wrapper.find('.login-button').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  pushMock.mockClear()
})

describe('Login.vue', () => {
  it('用例A：账号/密码为空时点击登录，不调用 auth store 的 login', async () => {
    const { wrapper, loginSpy } = await mountLogin()
    await wrapper.find('.login-button').trigger('click')
    await flushPromises()
    expect(loginSpy).not.toHaveBeenCalled()
  })

  it('用例B1：登录成功（admin）→ router.push("/admin/overview")', async () => {
    const { wrapper, loginSpy } = await mountLogin()
    loginSpy.mockResolvedValue(makeUser('admin'))
    await fillAndSubmit(wrapper, 'admin', 'admin123')
    expect(loginSpy).toHaveBeenCalledWith({ username: 'admin', password: 'admin123' })
    expect(pushMock).toHaveBeenCalledWith('/admin/overview')
  })

  it('用例B2：登录成功（teacher）→ router.push("/teacher/dashboard")', async () => {
    const { wrapper, loginSpy } = await mountLogin()
    loginSpy.mockResolvedValue(makeUser('teacher'))
    await fillAndSubmit(wrapper, 't001', 'x8kP2mQ!')
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/teacher/dashboard')
  })

  it('用例B3：登录成功（student）→ router.push("/student/tasks")', async () => {
    const { wrapper, loginSpy } = await mountLogin()
    loginSpy.mockResolvedValue(makeUser('student'))
    await fillAndSubmit(wrapper, 's001', 'a1b2c3d4')
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/student/tasks')
  })

  it('用例C：登录失败（store.login reject）→ 不跳转', async () => {
    const { wrapper, loginSpy } = await mountLogin()
    loginSpy.mockRejectedValue(new Error('账号或密码错误'))
    await fillAndSubmit(wrapper, 'admin', 'wrong-password')
    expect(loginSpy).toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../index'
import { TOKEN_KEY, USER_KEY } from '@/utils/request'
import type { UserInfo } from '@/stores/auth'

const baseUser: UserInfo = {
  id: 1,
  username: 's001',
  realName: '张三',
  role: 'student',
  classId: 1,
  mustChangePassword: false,
}

function loginAs(overrides: Partial<UserInfo> = {}) {
  localStorage.setItem(TOKEN_KEY, 'test-token')
  localStorage.setItem(USER_KEY, JSON.stringify({ ...baseUser, ...overrides }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('路由守卫', () => {
  it('未登录访问业务页 → 重定向 /login', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/teacher/dashboard')
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('未登录访问 /login 本身放行', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('学生角色访问超管页 → 跳学生端首页 /student/tasks', async () => {
    loginAs()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/admin/overview')
    expect(router.currentRoute.value.path).toBe('/student/tasks')
  })

  it('学生访问本端带参页面（打字练习）→ 正常放行', async () => {
    loginAs()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/student/typing/9')
    expect(router.currentRoute.value.path).toBe('/student/typing/9')
  })

  it('已登录且需强制改密 → 访问业务页被拦截到 /change-password', async () => {
    loginAs({ mustChangePassword: true })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/student/tasks')
    expect(router.currentRoute.value.path).toBe('/change-password')
  })

  it('已登录且需强制改密 → 访问 /change-password 放行', async () => {
    loginAs({ mustChangePassword: true })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/change-password')
    expect(router.currentRoute.value.path).toBe('/change-password')
  })

  it('已登录无需改密访问 /login → 重定向角色首页', async () => {
    loginAs()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/student/tasks')
  })

  it('已登录仍需改密访问 /login → 留在登录页', async () => {
    loginAs({ mustChangePassword: true })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/login')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../index'
import { TOKEN_KEY, USER_KEY } from '@/utils/request'

const studentUser = {
  id: 1,
  username: 's001',
  realName: '张三',
  role: 'student',
  classId: 1,
  mustChangePassword: false,
}

function loginAsStudent() {
  localStorage.setItem(TOKEN_KEY, 'test-token')
  localStorage.setItem(USER_KEY, JSON.stringify(studentUser))
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
    loginAsStudent()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/admin/overview')
    expect(router.currentRoute.value.path).toBe('/student/tasks')
  })

  it('学生访问本端带参页面（打字练习）→ 正常放行', async () => {
    loginAsStudent()
    const router = createAppRouter(createMemoryHistory())
    await router.push('/student/typing/9')
    expect(router.currentRoute.value.path).toBe('/student/typing/9')
  })
})

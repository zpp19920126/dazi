import { defineStore } from 'pinia'
import request, { TOKEN_KEY, USER_KEY } from '@/utils/request'

export type Role = 'admin' | 'teacher' | 'student'

/** 各角色登录后的首页（守卫与登录/改密页共用的单一来源；置于 store 层避免页面组件反向依赖 router 造成循环初始化） */
export const roleHome: Record<Role, string> = {
  student: '/student/tasks',
  teacher: '/teacher/dashboard',
  admin: '/admin/overview',
}

/** 登录接口返回的用户信息（与后端 POST /api/auth/login 约定一致） */
export interface UserInfo {
  id: number
  username: string
  realName: string
  role: Role
  classId: number | null
  mustChangePassword: boolean
}

function loadUser(): UserInfo | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserInfo
  } catch {
    // localStorage 数据损坏时清掉脏数据兜底，避免 store 初始化抛错导致应用白屏
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    user: loadUser(),
  }),
  getters: {
    isLoggedIn: (state) => state.token !== '',
  },
  actions: {
    /** 登录：调用 /auth/login，成功后持久化 token 与用户信息，并返回用户信息供页面按角色跳转 */
    async login(payload: { username: string; password: string }): Promise<UserInfo> {
      const data = await request.post<{ token: string; user: UserInfo }>('/auth/login', payload)
      this.token = data.token
      this.user = data.user
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      return data.user
    },
    /** 修改密码成功后清除强制改密标记并同步持久化 */
    markPasswordChanged() {
      if (this.user) {
        this.user.mustChangePassword = false
        localStorage.setItem(USER_KEY, JSON.stringify(this.user))
      }
    },
    /** 退出登录：清空登录态并跳转登录页 */
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      // 动态 import router，避免 router → store → router 循环依赖
      void import('@/router').then(({ default: router }) => router.push('/login'))
    },
  },
})

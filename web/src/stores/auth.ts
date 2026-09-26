import { defineStore } from 'pinia'
import request, { TOKEN_KEY, USER_KEY } from '@/utils/request'

export type Role = 'admin' | 'teacher' | 'student'

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
  return raw ? (JSON.parse(raw) as UserInfo) : null
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
    /** 登录：调用 /auth/login，成功后持久化 token 与用户信息 */
    async login(payload: { username: string; password: string }) {
      const data = await request.post<{ token: string; user: UserInfo }>('/auth/login', payload)
      this.token = data.token
      this.user = data.user
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
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

import axios, { type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

/** 本地存储 key（auth store 共用，导出以保证单一来源，避免反向循环依赖） */
export const TOKEN_KEY = 'typing_token'
export const USER_KEY = 'typing_user'

/** 清除本地登录态 */
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

const instance = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截：自动附加 JWT
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一解包 { code, message, data }，code === 0 视为业务成功
instance.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) {
        // 解包：调用方直接拿到 data
        return body.data
      }
      ElMessage.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message || '请求失败'))
    }
    return body
  },
  (error) => {
    const status: number | undefined = error.response?.status
    if (!error.response) {
      ElMessage.error('网络异常')
    } else if (status === 401) {
      // 未登录 / token 失效：清登录态并跳登录页。
      // 动态 import router，避免 request → router → store → request 循环依赖
      clearAuth()
      ElMessage.error(error.response.data?.message || '登录已失效，请重新登录')
      void import('@/router').then(({ default: router }) => router.push('/login'))
    } else {
      ElMessage.error(error.response.data?.message || `请求失败（${status ?? ''}）`)
    }
    return Promise.reject(error)
  },
)

/**
 * 对外暴露的类型：响应拦截器已把 { code, message, data } 解包，
 * 因此各方法直接返回 Promise<data> 而非 AxiosResponse。
 */
export interface HttpClient {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
}

export default instance as unknown as HttpClient

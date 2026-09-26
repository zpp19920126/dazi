import { createRouter, createWebHistory, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore, type Role } from '@/stores/auth'
import AdminLayout from '@/layouts/AdminLayout.vue'
import StudentLayout from '@/layouts/StudentLayout.vue'
import TeacherLayout from '@/layouts/TeacherLayout.vue'
import ChangePasswordView from '@/views/ChangePassword.vue'
import LoginView from '@/views/Login.vue'
import Placeholder from '@/views/Placeholder.vue'

/** 各角色登录后的首页 */
export const roleHome: Record<Role, string> = {
  student: '/student/tasks',
  teacher: '/teacher/dashboard',
  admin: '/admin/overview',
}

// 路由表：登录/改密 + 学生/教师/超管三端布局壳（子页面均为占位，由后续任务替换）
export const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { title: '登录' } },
  {
    path: '/change-password',
    name: 'change-password',
    component: ChangePasswordView,
    meta: { title: '修改密码' },
  },
  {
    path: '/student',
    component: StudentLayout,
    redirect: roleHome.student,
    meta: { roles: ['student'] },
    children: [
      {
        path: 'tasks',
        name: 'student-tasks',
        component: Placeholder,
        meta: { roles: ['student'], title: '我的任务' },
      },
      {
        path: 'typing/:taskId?',
        name: 'student-typing',
        component: Placeholder,
        meta: { roles: ['student'], title: '打字练习' },
      },
      {
        path: 'records',
        name: 'student-records',
        component: Placeholder,
        meta: { roles: ['student'], title: '我的成绩' },
      },
      {
        path: 'profile',
        name: 'student-profile',
        component: Placeholder,
        meta: { roles: ['student'], title: '个人中心' },
      },
    ],
  },
  {
    path: '/teacher',
    component: TeacherLayout,
    redirect: roleHome.teacher,
    meta: { roles: ['teacher'] },
    children: [
      {
        path: 'dashboard',
        name: 'teacher-dashboard',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '工作台' },
      },
      {
        path: 'classes',
        name: 'teacher-classes',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '班级管理' },
      },
      {
        path: 'students',
        name: 'teacher-students',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '学生账号' },
      },
      {
        path: 'texts',
        name: 'teacher-texts',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '自建文章' },
      },
      {
        path: 'tasks',
        name: 'teacher-tasks',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '任务管理' },
      },
      {
        // 实时看板依赖具体班级，从任务管理进入，不放入侧边固定菜单
        path: 'live/:classId',
        name: 'teacher-live',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '实时看板' },
      },
      {
        path: 'grades',
        name: 'teacher-grades',
        component: Placeholder,
        meta: { roles: ['teacher'], title: '成绩查询' },
      },
    ],
  },
  {
    path: '/admin',
    component: AdminLayout,
    redirect: roleHome.admin,
    meta: { roles: ['admin'] },
    children: [
      {
        path: 'overview',
        name: 'admin-overview',
        component: Placeholder,
        meta: { roles: ['admin'], title: '系统概览' },
      },
      {
        path: 'teachers',
        name: 'admin-teachers',
        component: Placeholder,
        meta: { roles: ['admin'], title: '教师账号' },
      },
      {
        path: 'texts',
        name: 'admin-texts',
        component: Placeholder,
        meta: { roles: ['admin'], title: '全局文章库' },
      },
    ],
  },
]

/**
 * 创建应用路由。history 参数便于测试注入 createMemoryHistory()，
 * 应用入口使用默认的 createWebHistory()。
 */
export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes })

  // 全局守卫：未登录 → /login；角色不匹配 → 跳对应端首页
  router.beforeEach((to) => {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) {
      return to.path === '/login' ? true : '/login'
    }
    const roles = to.meta.roles as Role[] | undefined
    const role = auth.user?.role
    if (roles && role && !roles.includes(role)) {
      return roleHome[role]
    }
    return true
  })

  return router
}

export default createAppRouter()

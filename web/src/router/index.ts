import { createRouter, createWebHistory, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore, roleHome, type Role } from '@/stores/auth'
import AdminLayout from '@/layouts/AdminLayout.vue'
import StudentLayout from '@/layouts/StudentLayout.vue'
import TeacherLayout from '@/layouts/TeacherLayout.vue'
import ChangePasswordView from '@/views/ChangePassword.vue'
import LoginView from '@/views/Login.vue'
import MyTasksView from '@/views/student/MyTasks.vue'
import TypingView from '@/views/student/Typing.vue'
import MyRecordsView from '@/views/student/MyRecords.vue'
import ProfileView from '@/views/student/Profile.vue'
import TeacherDashboardView from '@/views/teacher/Dashboard.vue'
import TeacherClassListView from '@/views/teacher/ClassList.vue'
import TeacherStudentListView from '@/views/teacher/StudentList.vue'
import TeacherMyTextsView from '@/views/teacher/MyTexts.vue'
import TeacherTaskListView from '@/views/teacher/TaskList.vue'
import TeacherLiveBoardView from '@/views/teacher/LiveBoard.vue'
import TeacherGradesView from '@/views/teacher/Grades.vue'
import TeacherSessionAttendanceView from '@/views/teacher/SessionAttendance.vue'
import AdminOverviewView from '@/views/admin/Overview.vue'
import AdminTeacherAccountsView from '@/views/admin/TeacherAccounts.vue'
import AdminAllTextsView from '@/views/admin/AllTexts.vue'

// roleHome 真身在 stores/auth.ts（避免页面组件反向依赖 router 形成循环初始化），此处保持既有导出位置兼容
export { roleHome }

// 路由表：登录/改密 + 学生/教师/超管三端布局壳
export const routes: RouteRecordRaw[] = [
  // 根路径兜底：未登录由守卫送往 /login，已登录经 /login 守卫弹到对应角色首页
  { path: '/', redirect: '/login' },
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
        component: MyTasksView,
        meta: { roles: ['student'], title: '我的任务' },
      },
      {
        path: 'typing/:taskId?',
        name: 'student-typing',
        component: TypingView,
        meta: { roles: ['student'], title: '打字练习' },
      },
      {
        path: 'records',
        name: 'student-records',
        component: MyRecordsView,
        meta: { roles: ['student'], title: '我的成绩' },
      },
      {
        path: 'profile',
        name: 'student-profile',
        component: ProfileView,
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
        component: TeacherDashboardView,
        meta: { roles: ['teacher'], title: '工作台' },
      },
      {
        path: 'classes',
        name: 'teacher-classes',
        component: TeacherClassListView,
        meta: { roles: ['teacher'], title: '班级管理' },
      },
      {
        path: 'students',
        name: 'teacher-students',
        component: TeacherStudentListView,
        meta: { roles: ['teacher'], title: '学生账号' },
      },
      {
        path: 'texts',
        name: 'teacher-texts',
        component: TeacherMyTextsView,
        meta: { roles: ['teacher'], title: '自建文章' },
      },
      {
        path: 'tasks',
        name: 'teacher-tasks',
        component: TeacherTaskListView,
        meta: { roles: ['teacher'], title: '任务管理' },
      },
      {
        // 实时看板依赖具体班级，从任务管理进入，不放入侧边固定菜单
        path: 'live/:classId',
        name: 'teacher-live',
        component: TeacherLiveBoardView,
        meta: { roles: ['teacher'], title: '实时看板' },
      },
      {
        path: 'grades',
        name: 'teacher-grades',
        component: TeacherGradesView,
        meta: { roles: ['teacher'], title: '成绩查询' },
      },
      {
        path: 'attendance',
        name: 'teacher-attendance',
        component: TeacherSessionAttendanceView,
        meta: { roles: ['teacher'], title: '开课考勤' },
      },
      {
        path: 'homeworks',
        name: 'teacher-homeworks',
        component: () => import('@/views/teacher/HomeworkList.vue'),
        meta: { title: '作业管理', roles: ['teacher', 'admin'] },
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
        component: AdminOverviewView,
        meta: { roles: ['admin'], title: '系统概览' },
      },
      {
        path: 'teachers',
        name: 'admin-teachers',
        component: AdminTeacherAccountsView,
        meta: { roles: ['admin'], title: '教师账号' },
      },
      {
        path: 'texts',
        name: 'admin-texts',
        component: AdminAllTextsView,
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

  // 全局守卫：未登录 → /login；强制改密 → 只能去 /change-password；角色不匹配 → 跳对应端首页
  router.beforeEach((to) => {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) {
      return to.path === '/login' ? true : '/login'
    }
    const user = auth.user
    const mustChange = user?.mustChangePassword === true
    // 已登录访问 /login：无需改密 → 回角色首页；仍需改密 → 留在登录页（允许切换账号重新登录）
    if (to.path === '/login') {
      return mustChange || !user ? true : roleHome[user.role]
    }
    // 首次登录强制改密：除改密页外一律拦截
    if (mustChange && to.path !== '/change-password') {
      return '/change-password'
    }
    const roles = to.meta.roles as Role[] | undefined
    const role = user?.role
    if (roles && role && !roles.includes(role)) {
      return roleHome[role]
    }
    return true
  })

  return router
}

export default createAppRouter()

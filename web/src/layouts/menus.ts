/** 侧边菜单项；children 存在时渲染为可展开分组 */
export interface MenuItem {
  /** 完整路由路径，如 /student/tasks；分组项无 path */
  path?: string
  /** 菜单中文名 */
  label: string
  children?: MenuItem[]
}

// 菜单项与设计文档第 7 节页面清单一一对应（实时看板依赖班级参数，从任务管理进入，不设固定菜单项）
export const studentMenus: MenuItem[] = [
  { path: '/student/tasks', label: '我的任务' },
  { path: '/student/typing', label: '打字练习' },
  { path: '/student/records', label: '我的成绩' },
  { path: '/student/profile', label: '个人中心' },
]

export const teacherMenus: MenuItem[] = [
  { path: '/teacher/dashboard', label: '工作台' },
  { path: '/teacher/classes', label: '班级管理' },
  { path: '/teacher/students', label: '学生账号' },
  { path: '/teacher/texts', label: '自建文章' },
  { path: '/teacher/tasks', label: '任务管理' },
  { path: '/teacher/grades', label: '成绩查询' },
  {
    label: '课堂管理',
    children: [
      { path: '/teacher/attendance', label: '开课考勤' },
      { path: '/teacher/homeworks', label: '作业管理' },
    ],
  },
]

export const adminMenus: MenuItem[] = [
  { path: '/admin/overview', label: '系统概览' },
  { path: '/admin/teachers', label: '教师账号' },
  { path: '/admin/texts', label: '全局文章库' },
]

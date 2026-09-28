import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as XLSX from 'xlsx'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/request', () => ({ default: { get: getMock, post: postMock } }))

import StudentList from '../teacher/StudentList.vue'

const classes = [
  { id: 1, name: '一班', teacherId: 10, createdAt: '2026-09-01T00:00:00.000Z', studentCount: 2 },
  { id: 2, name: '二班', teacherId: 10, createdAt: '2026-09-02T00:00:00.000Z', studentCount: 0 },
]
const students = [
  {
    id: 101,
    username: 's001',
    realName: '张三',
    status: 'active',
    mustChangePassword: false,
    lastLoginAt: '2026-09-26T10:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
]

describe('StudentList.vue 教师学生账号页', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('挂载后加载班级并默认展示第一个班级的学生列表', async () => {
    getMock.mockResolvedValueOnce({ list: classes, total: 2 }).mockResolvedValueOnce({ list: students })
    const wrapper = mount(StudentList, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    expect(getMock).toHaveBeenNthCalledWith(1, '/classes')
    expect(getMock).toHaveBeenNthCalledWith(2, '/users/students', { params: { classId: 1 } })
    expect(wrapper.findAll('[data-testid="students-table"] .el-table__row')).toHaveLength(1)
    wrapper.unmount()
  })

  it('批量生成弹窗提交后结果表格行数与 created 一致，并刷新学生列表', async () => {
    getMock
      .mockResolvedValueOnce({ list: classes, total: 2 })
      .mockResolvedValueOnce({ list: students })
      .mockResolvedValueOnce({ list: students })
    postMock.mockResolvedValue({
      created: [
        { username: 's002', realName: '李四', initialPassword: 'Ab@12345' },
        { username: 's003', realName: '王五', initialPassword: 'Cd@67890' },
      ],
      usernameStart: 's002',
    })
    const wrapper = mount(StudentList, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="batch-btn"]').trigger('click')
    const dialog = wrapper.find('[data-testid="batch-dialog"]')
    expect(dialog.exists()).toBe(true)

    await dialog.find('textarea[data-testid="names-input"]').setValue('李四\n王五\n')
    await dialog.find('[data-testid="batch-submit"]').trigger('click')
    await flushPromises()

    expect(postMock).toHaveBeenCalledWith('/users/students/batch', {
      classId: 1,
      names: ['李四', '王五'],
    })
    expect(wrapper.findAll('[data-testid="batch-result-table"] .el-table__row')).toHaveLength(2)
    // 提交成功后重新拉取学生列表
    expect(getMock).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('点击导出按钮生成 xlsx Blob 触发下载，内容含学生账号/姓名/初始密码', async () => {
    getMock
      .mockResolvedValueOnce({ list: classes, total: 2 })
      .mockResolvedValueOnce({ list: students })
      .mockResolvedValueOnce({ list: students })
    postMock.mockResolvedValue({
      created: [
        { username: 's002', realName: '李四', initialPassword: 'Ab@12345' },
        { username: 's003', realName: '王五', initialPassword: 'Cd@67890' },
      ],
      usernameStart: 's002',
    })
    const wrapper = mount(StudentList, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="batch-btn"]').trigger('click')
    const dialog = wrapper.find('[data-testid="batch-dialog"]')
    await dialog.find('textarea[data-testid="names-input"]').setValue('李四\n王五\n')
    await dialog.find('[data-testid="batch-submit"]').trigger('click')
    await flushPromises()

    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await dialog.find('[data-testid="export-btn"]').trigger('click')
    await flushPromises()

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0] as Blob
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    // 解析 xlsx 校验表头与行内容
    const buf = await blob.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]!])
    expect(rows).toEqual([
      { 学生账号: 's002', 姓名: '李四', 初始密码: 'Ab@12345' },
      { 学生账号: 's003', 姓名: '王五', 初始密码: 'Cd@67890' },
    ])
    wrapper.unmount()
  })
})

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as XLSX from 'xlsx'
import request from '@/utils/request'

interface ClassItem {
  id: number
  name: string
  studentCount: number
}

interface StudentItem {
  id: number
  username: string
  realName: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  initialPassword: string | null
  lastLoginAt: string | null
  createdAt: string
}

interface CreatedAccount {
  username: string
  realName: string
  initialPassword: string
}

const loading = ref(false)
const classes = ref<ClassItem[]>([])
const classId = ref<number | null>(null)
const students = ref<StudentItem[]>([])

// 批量生成弹窗状态：输入 → 提交 → 结果（初始密码仅显示一次）
const batchVisible = ref(false)
const namesText = ref('')
const submitting = ref(false)
const batchResult = ref<CreatedAccount[]>([])

// 编辑弹窗：修改姓名与状态（停用/启用）
const editVisible = ref(false)
const editing = ref<StudentItem | null>(null)
const editForm = reactive<{ realName: string; status: 'active' | 'disabled' }>({
  realName: '',
  status: 'active',
})

// 批量删除：表格勾选行
const selected = ref<StudentItem[]>([])

function openEdit(row: StudentItem) {
  editing.value = row
  editForm.realName = row.realName
  editForm.status = row.status
  editVisible.value = true
}

async function saveEdit() {
  if (!editing.value) return
  const realName = editForm.realName.trim()
  if (!realName) {
    ElMessage.warning('姓名不能为空')
    return
  }
  await request.patch(`/users/students/${editing.value.id}`, {
    realName,
    status: editForm.status,
  })
  ElMessage.success('已保存')
  editVisible.value = false
  await loadStudents()
}

/** 确认弹窗：确认返回 true，取消返回 false */
async function confirmBox(message: string, title: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}

async function removeStudent(row: StudentItem) {
  const ok = await confirmBox(
    `确定删除学生「${row.realName}（${row.username}）」吗？其打字记录将一并清除，删除后不可恢复。`,
    '删除确认',
  )
  if (!ok) return
  await request.delete(`/users/students/${row.id}`)
  ElMessage.success('已删除')
  await loadStudents()
}

function onSelectionChange(rows: StudentItem[]) {
  selected.value = rows
}

async function batchDelete() {
  if (selected.value.length === 0) return
  const count = selected.value.length
  const ok = await confirmBox(
    `确定删除选中的 ${count} 名学生吗？其打字记录将一并清除，删除后不可恢复。`,
    '批量删除确认',
  )
  if (!ok) return
  const ids = selected.value.map((s) => s.id)
  const data = await request.post<{ deleted: number }>('/users/students/batch-delete', { ids })
  ElMessage.success(`已删除 ${data.deleted} 名学生`)
  await loadStudents()
}

async function loadStudents() {
  if (classId.value === null) return
  loading.value = true
  try {
    const data = await request.get<{ list: StudentItem[] }>('/users/students', {
      params: { classId: classId.value },
    })
    students.value = data.list
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const data = await request.get<{ list: ClassItem[]; total: number }>('/classes')
  classes.value = data.list
  // 默认选中第一个班级并展示其学生
  if (data.list.length > 0 && classId.value === null) {
    classId.value = data.list[0].id
    await loadStudents()
  }
})

function openBatch() {
  namesText.value = ''
  batchResult.value = []
  batchVisible.value = true
}

async function submitBatch() {
  const names = namesText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.length === 0 || classId.value === null) {
    ElMessage.warning('请每行输入一个学生姓名')
    return
  }
  submitting.value = true
  try {
    const data = await request.post<{ created: CreatedAccount[]; usernameStart: string }>(
      '/users/students/batch',
      { classId: classId.value, names },
    )
    batchResult.value = data.created
    ElMessage.success(`成功生成 ${data.created.length} 个学生账号`)
    await loadStudents()
  } finally {
    submitting.value = false
  }
}

async function copyAll() {
  const lines = batchResult.value.map(
    (r) => `${r.username} ${r.realName} 初始密码：${r.initialPassword}`,
  )
  await navigator.clipboard.writeText(lines.join('\n'))
  ElMessage.success('已复制全部账号与初始密码')
}

// 生成 xlsx 并触发浏览器下载（弹窗导出与学生列表导出共用）
function downloadXlsx(aoa: string[][], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = aoa[0]!.map(() => ({ wch: 16 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '学生账号')
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 弹窗内导出本次批量生成的账号与初始密码
function exportExcel() {
  downloadXlsx(
    [
      ['学生账号', '姓名', '初始密码'],
      ...batchResult.value.map((r) => [r.username, r.realName, r.initialPassword]),
    ],
    `学生账号_${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
  ElMessage.success('已导出 Excel')
}

// 学生列表导出：账号/姓名/初始密码（改密后为空则显示已改密），便于事后补导出
function exportListExcel() {
  const className = classes.value.find((c) => c.id === classId.value)?.name ?? ''
  downloadXlsx(
    [
      ['学生账号', '姓名', '初始密码'],
      ...students.value.map((s) => [
        s.username,
        s.realName,
        s.initialPassword ?? '（已改密）',
      ]),
    ],
    `学生账号_${className}_${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
  ElMessage.success('已导出 Excel')
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}
</script>

<template>
  <div v-loading="loading">
    <h3>学生账号</h3>
    <div style="margin-bottom: 16px; display: flex; gap: 12px; align-items: center">
      <el-select
        v-model="classId"
        placeholder="选择班级"
        style="width: 240px"
        @change="loadStudents"
      >
        <el-option
          v-for="c in classes"
          :key="c.id"
          :label="`${c.name}（${c.studentCount}人）`"
          :value="c.id"
        />
      </el-select>
      <el-button
        data-testid="batch-btn"
        type="primary"
        :disabled="classId === null"
        @click="openBatch"
      >
        批量生成学生
      </el-button>
      <el-button data-testid="export-list-btn" :disabled="classId === null" @click="exportListExcel">
        导出Excel
      </el-button>
      <el-button
        data-testid="batch-delete-btn"
        type="danger"
        :disabled="selected.length === 0"
        @click="batchDelete"
      >
        批量删除
      </el-button>
    </div>

    <el-table :data="students" data-testid="students-table" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="45" />
      <el-table-column prop="username" label="用户名" width="120" />
      <el-table-column prop="realName" label="姓名" width="140" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">正常</el-tag>
          <el-tag v-else type="danger">停用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="待改密" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.mustChangePassword" type="warning">是</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" width="180">
        <template #default="{ row }">{{ fmtTime(row.lastLoginAt) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button data-testid="edit-btn" link type="primary" @click="openEdit(row)">
            编辑
          </el-button>
          <el-button data-testid="delete-btn" link type="danger" @click="removeStudent(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="batchVisible" title="批量生成学生" width="640px">
      <div data-testid="batch-dialog">
        <template v-if="batchResult.length === 0">
          <p style="margin: 0 0 8px">每行一个学生姓名，系统自动生成用户名（s 序列）与初始密码：</p>
          <el-input
            v-model="namesText"
            type="textarea"
            :rows="6"
            data-testid="names-input"
            placeholder="例如：&#10;张三&#10;李四"
          />
          <div style="margin-top: 12px; text-align: right">
            <el-button
              data-testid="batch-submit"
              type="primary"
              :loading="submitting"
              @click="submitBatch"
            >
              生成账号
            </el-button>
          </div>
        </template>
        <template v-else>
          <el-alert
            type="success"
            :closable="false"
            title="生成成功！初始密码仅此一次显示，请复制保存。"
          />
          <el-table :data="batchResult" data-testid="batch-result-table" style="margin-top: 12px">
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="realName" label="姓名" width="140" />
            <el-table-column prop="initialPassword" label="初始密码" />
          </el-table>
          <div style="margin-top: 12px; text-align: right">
            <el-button data-testid="export-btn" @click="exportExcel">导出Excel</el-button>
            <el-button data-testid="copy-btn" type="primary" @click="copyAll">
              一键复制全部
            </el-button>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑学生" width="440px">
      <div data-testid="edit-dialog">
        <el-form label-width="70px">
          <el-form-item label="用户名">
            <span>{{ editing?.username }}</span>
          </el-form-item>
          <el-form-item label="姓名">
            <el-input
              v-model="editForm.realName"
              data-testid="edit-name-input"
              maxlength="50"
              placeholder="学生姓名"
            />
          </el-form-item>
          <el-form-item label="状态">
            <el-switch
              v-model="editForm.status"
              data-testid="edit-status-switch"
              active-value="active"
              inactive-value="disabled"
              active-text="正常"
              inactive-text="停用"
            />
          </el-form-item>
        </el-form>
        <div style="text-align: right">
          <el-button @click="editVisible = false">取消</el-button>
          <el-button data-testid="edit-save" type="primary" @click="saveEdit">保存</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
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
    </div>

    <el-table :data="students" data-testid="students-table">
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
            <el-button data-testid="copy-btn" type="primary" @click="copyAll">
              一键复制全部
            </el-button>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

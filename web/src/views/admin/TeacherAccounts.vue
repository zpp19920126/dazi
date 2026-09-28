<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface TeacherItem {
  id: number
  username: string
  realName: string
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  createdAt: string
  classCount: number
}

const loading = ref(false)
const list = ref<TeacherItem[]>([])
const page = ref(1)
const pageSize = 10
const total = ref(0)
const keyword = ref('')

// 新建弹窗：提交后展示初始密码（仅此一次）
const createVisible = ref(false)
const submitting = ref(false)
const form = reactive({ realName: '', username: '' })
const created = ref<{ username: string; initialPassword: string } | null>(null)

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: TeacherItem[]; total: number }>('/users/teachers', {
      params: { page: page.value, pageSize, keyword: keyword.value || undefined },
    })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function openCreate() {
  form.realName = ''
  form.username = ''
  created.value = null
  createVisible.value = true
}

async function submitCreate() {
  if (!form.realName.trim()) {
    ElMessage.warning('请输入教师姓名')
    return
  }
  submitting.value = true
  try {
    const data = await request.post<{ user: { username: string }; initialPassword: string }>(
      '/users/teachers',
      { realName: form.realName.trim(), username: form.username.trim() || undefined },
    )
    created.value = { username: data.user.username, initialPassword: data.initialPassword }
    await load()
  } finally {
    submitting.value = false
  }
}

async function copyCreated() {
  if (!created.value) return
  await navigator.clipboard.writeText(
    `${created.value.username} ${created.value.initialPassword}`,
  )
  ElMessage.success('已复制用户名与初始密码')
}

async function resetPassword(row: TeacherItem) {
  await ElMessageBox.confirm(`确定重置「${row.realName}」的密码吗？`, '重置密码', {
    type: 'warning',
  }).catch(() => null)
  const data = await request.patch<{ initialPassword: string }>(`/users/${row.id}`, {
    action: 'reset-password',
  })
  ElMessageBox.alert(`新初始密码：${data.initialPassword}（仅此一次显示）`, '重置成功', {
    type: 'success',
  }).catch(() => null)
}

async function patchAction(row: TeacherItem, action: 'disable' | 'enable' | 'delete') {
  if (action === 'delete') {
    await ElMessageBox.confirm(
      `确定删除教师「${row.realName}」吗？需先处理其班级与学生。`,
      '删除确认',
      { type: 'warning' },
    ).catch(() => null)
  }
  await request.patch(`/users/${row.id}`, { action })
  ElMessage.success(action === 'delete' ? '已删除' : action === 'disable' ? '已停用' : '已启用')
  await load()
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>教师账号</h3>
    <div style="margin-bottom: 16px; display: flex; gap: 12px">
      <el-input
        v-model="keyword"
        placeholder="搜索用户名 / 姓名"
        style="width: 240px"
        clearable
        data-testid="teacher-keyword"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button data-testid="teacher-search" @click="search">搜索</el-button>
      <el-button data-testid="create-teacher-btn" type="primary" @click="openCreate">
        新建教师
      </el-button>
    </div>

    <el-table :data="list" data-testid="teachers-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="username" label="用户名" width="120" />
      <el-table-column prop="realName" label="姓名" width="140" />
      <el-table-column label="状态" width="90">
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
      <el-table-column prop="classCount" label="班级数" width="90" />
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="resetPassword(row)">重置密码</el-button>
          <el-button
            v-if="row.status === 'active'"
            link
            type="warning"
            @click="patchAction(row, 'disable')"
          >
            停用
          </el-button>
          <el-button v-else link type="success" @click="patchAction(row, 'enable')">
            启用
          </el-button>
          <el-button link type="danger" @click="patchAction(row, 'delete')">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      style="margin-top: 16px; justify-content: flex-end"
      layout="total, prev, pager, next"
      :total="total"
      :page-size="pageSize"
      @current-change="load"
    />

    <el-dialog v-model="createVisible" title="新建教师" width="480px" data-testid="create-teacher-dialog">
      <template v-if="!created">
        <el-form label-width="80px">
          <el-form-item label="姓名">
            <el-input
              v-model="form.realName"
              data-testid="teacher-realname"
              maxlength="50"
              placeholder="教师姓名"
            />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input
              v-model="form.username"
              data-testid="teacher-username"
              placeholder="留空自动生成（t 序列）"
            />
          </el-form-item>
        </el-form>
        <div style="text-align: right">
          <el-button data-testid="teacher-submit" type="primary" :loading="submitting" @click="submitCreate">
            创建
          </el-button>
        </div>
      </template>
      <template v-else>
        <el-alert type="success" :closable="false" title="创建成功！初始密码仅此一次显示，请复制保存。" />
        <p style="margin: 12px 0">
          用户名：{{ created.username }}　初始密码：{{ created.initialPassword }}
        </p>
        <div style="text-align: right">
          <el-button data-testid="copy-teacher" type="primary" @click="copyCreated">复制</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

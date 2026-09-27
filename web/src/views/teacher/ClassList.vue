<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface ClassItem {
  id: number
  name: string
  teacherId: number
  createdAt: string
  studentCount: number
}

const loading = ref(false)
const list = ref<ClassItem[]>([])

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: ClassItem[]; total: number }>('/classes')
    list.value = data.list
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 新建 / 重命名共用弹窗
const dialogVisible = ref(false)
const editing = ref<ClassItem | null>(null)
const submitting = ref(false)
const name = ref('')

function openCreate() {
  editing.value = null
  name.value = ''
  dialogVisible.value = true
}

function openRename(row: ClassItem) {
  editing.value = row
  name.value = row.name
  dialogVisible.value = true
}

async function submit() {
  const n = name.value.trim()
  if (!n) {
    ElMessage.warning('请输入班级名称')
    return
  }
  submitting.value = true
  try {
    if (editing.value) {
      await request.patch(`/classes/${editing.value.id}`, { name: n })
      ElMessage.success('重命名成功')
    } else {
      await request.post('/classes', { name: n })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: ClassItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除班级「${row.name}」？仅允许删除无学生、无任务的空班级。`,
      '删除确认',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await request.delete(`/classes/${row.id}`)
    ElMessage.success('删除成功')
    await load()
  } catch {
    // 班级非空（409）等错误已由拦截器统一提示
  }
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}
</script>

<template>
  <div v-loading="loading">
    <h3>班级管理</h3>
    <div style="margin-bottom: 16px">
      <el-button data-testid="create-btn" type="primary" @click="openCreate">新建班级</el-button>
    </div>
    <el-table :data="list" data-testid="classes-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="班级名称" min-width="160" />
      <el-table-column prop="studentCount" label="学生数" width="100" />
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button size="small" @click="openRename(row)">重命名</el-button>
          <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '重命名班级' : '新建班级'" width="420px">
      <el-input
        v-model="name"
        data-testid="class-name-input"
        placeholder="班级名称"
        maxlength="100"
        @keyup.enter="submit"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button data-testid="class-submit" type="primary" :loading="submitting" @click="submit">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

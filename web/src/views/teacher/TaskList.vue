<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import TaskCreate from './TaskCreate.vue'

interface TaskItem {
  id: number
  classId: number
  className: string
  classSize: number
  text: { id: number; title: string }
  title: string
  mode: 'article' | 'time'
  durationSeconds: number | null
  minSpeed: number
  minAccuracy: number
  deadline: string
  status: 'published' | 'closed'
  submittedCount: number
}

const router = useRouter()
const loading = ref(false)
const list = ref<TaskItem[]>([])
const page = ref(1)
const pageSize = 10
const total = ref(0)

const createVisible = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: TaskItem[]; total: number }>('/tasks', {
      params: { page: page.value, pageSize },
    })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function closeTask(row: TaskItem) {
  await ElMessageBox.confirm(
    `确定提前截止任务「${row.title}」吗？截止后学生将无法提交。`,
    '提前截止',
    { type: 'warning' },
  ).catch(() => null)
  await request.patch(`/tasks/${row.id}`, { action: 'close' })
  ElMessage.success('任务已截止')
  await load()
}

function goLive(row: TaskItem) {
  router.push(`/teacher/live/${row.classId}`)
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}

function progress(row: TaskItem): number {
  if (row.classSize === 0) return 0
  return Math.round((row.submittedCount / row.classSize) * 100)
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>任务管理</h3>
    <div style="margin-bottom: 16px">
      <el-button data-testid="create-task-btn" type="primary" @click="createVisible = true">
        发布任务
      </el-button>
    </div>

    <el-table :data="list" data-testid="tasks-table">
      <el-table-column prop="title" label="标题" min-width="160" />
      <el-table-column prop="className" label="班级" width="120" />
      <el-table-column label="文章" min-width="140">
        <template #default="{ row }">{{ row.text.title }}</template>
      </el-table-column>
      <el-table-column label="模式" width="90">
        <template #default="{ row }">
          {{ row.mode === 'time' ? `限时${row.durationSeconds}秒` : '整篇' }}
        </template>
      </el-table-column>
      <el-table-column label="达标线" width="130">
        <template #default="{ row }">{{ row.minSpeed }} 字/分 · {{ row.minAccuracy }}%</template>
      </el-table-column>
      <el-table-column label="完成率" width="150">
        <template #default="{ row }">
          <el-progress :percentage="progress(row)" />
        </template>
      </el-table-column>
      <el-table-column label="截止时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.deadline) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'published'" type="success">进行中</el-tag>
          <el-tag v-else type="info">已截止</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="goLive(row)">实时看板</el-button>
          <el-button
            v-if="row.status === 'published'"
            link
            type="warning"
            @click="closeTask(row)"
          >
            提前截止
          </el-button>
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

    <TaskCreate v-model="createVisible" @created="load" />
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface TaskOption {
  id: number
  title: string
  className: string
}

interface GradeRow {
  id: number
  user: { id: number; realName: string; username: string }
  speed: string
  accuracy: string
  durationSeconds: number
  isPassed: boolean | null
  isSuspicious: boolean
  createdAt: string
}

const tasks = ref<TaskOption[]>([])
const taskId = ref<number | null>(null)
const loading = ref(false)
const rows = ref<GradeRow[]>([])
const stats = ref({ avgSpeed: 0, avgAccuracy: 0, passedRate: 0 })
// 前端筛选：全部 / 仅达标 / 仅可疑
const filter = ref<'all' | 'passed' | 'suspicious'>('all')

const filteredRows = computed(() => {
  if (filter.value === 'passed') return rows.value.filter((r) => r.isPassed === true)
  if (filter.value === 'suspicious') return rows.value.filter((r) => r.isSuspicious)
  return rows.value
})

async function loadTasks() {
  const data = await request.get<{ list: TaskOption[] }>('/tasks', {
    params: { page: 1, pageSize: 100 },
  })
  tasks.value = data.list
}

async function loadGrades() {
  if (taskId.value === null) return
  loading.value = true
  try {
    const data = await request.get<{
      list: GradeRow[]
      stats: { avgSpeed: number; avgAccuracy: number; passedRate: number }
    }>(`/tasks/${taskId.value}/grades`, {
      params: { page: 1, pageSize: 500 },
    })
    rows.value = data.list
    stats.value = data.stats
  } finally {
    loading.value = false
  }
}

async function exportCsv() {
  if (taskId.value === null) return
  const blob = await request.get<Blob>(`/tasks/${taskId.value}/grades`, {
    params: { export: 'csv' },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grades-task-${taskId.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('CSV 已导出')
}

// 可疑成绩行 danger 高亮
function rowClassName({ row }: { row: GradeRow }): string {
  return row.isSuspicious ? 'suspicious-row' : ''
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}

onMounted(loadTasks)

// 任务切换（含测试直设 v-model）即重新加载成绩
watch(taskId, loadGrades)
</script>

<template>
  <div v-loading="loading">
    <h3>成绩查询</h3>
    <div style="margin-bottom: 16px; display: flex; gap: 12px; align-items: center">
      <el-select v-model="taskId" placeholder="选择任务" style="width: 280px">
        <el-option
          v-for="t in tasks"
          :key="t.id"
          :label="`${t.title}（${t.className}）`"
          :value="t.id"
        />
      </el-select>
      <el-radio-group v-model="filter">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="passed">仅达标</el-radio-button>
        <el-radio-button value="suspicious">仅可疑</el-radio-button>
      </el-radio-group>
      <el-button data-testid="export-csv" type="primary" plain @click="exportCsv">
        导出 CSV
      </el-button>
    </div>

    <el-row v-if="taskId !== null" :gutter="16" style="margin-bottom: 16px" data-testid="grades-stats">
      <el-col :span="8">
        <el-card shadow="never">
          <div>平均速度</div>
          <div style="font-size: 24px; font-weight: 600">{{ stats.avgSpeed }} 字/分</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <div>平均准确率</div>
          <div style="font-size: 24px; font-weight: 600">{{ stats.avgAccuracy }}%</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <div>达标率</div>
          <div style="font-size: 24px; font-weight: 600">{{ stats.passedRate }}%</div>
        </el-card>
      </el-col>
    </el-row>

    <el-table
      v-if="taskId !== null"
      :data="filteredRows"
      data-testid="grades-table"
      :row-class-name="rowClassName"
    >
      <el-table-column label="姓名" width="120">
        <template #default="{ row }">{{ row.user.realName }}</template>
      </el-table-column>
      <el-table-column label="用户名" width="110">
        <template #default="{ row }">{{ row.user.username }}</template>
      </el-table-column>
      <el-table-column label="速度（字/分）" width="130">
        <template #default="{ row }">{{ Number(row.speed).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="准确率" width="100">
        <template #default="{ row }">{{ Number(row.accuracy).toFixed(2) }}%</template>
      </el-table-column>
      <el-table-column label="用时（秒）" width="110">
        <template #default="{ row }">{{ row.durationSeconds }}</template>
      </el-table-column>
      <el-table-column label="达标" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.isPassed === true" type="success">达标</el-tag>
          <el-tag v-else-if="row.isPassed === false" type="danger">未达标</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="可疑" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.isSuspicious" type="warning">可疑</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="交卷时间" min-width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}

/* 可疑行 danger 高亮 */
:deep(tr.suspicious-row) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}
</style>

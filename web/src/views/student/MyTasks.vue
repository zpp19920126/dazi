<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'

interface MyRecord {
  speed: number | string
  accuracy: number | string
  isPassed: boolean | null
  createdAt: string
}
interface TaskDto {
  id: number
  title: string
  mode: 'article' | 'time'
  durationSeconds: number | null
  minSpeed: number
  minAccuracy: number
  deadline: string | null
  className?: string
  text: { id: number; title: string; language: string; difficulty: string; charCount: number }
  myRecord?: MyRecord | null
}

const router = useRouter()
const loading = ref(false)
const active = ref<TaskDto[]>([])
const history = ref<TaskDto[]>([])

onMounted(async () => {
  loading.value = true
  try {
    const data = await request.get<{ active: TaskDto[]; history: TaskDto[] }>('/tasks')
    active.value = data.active
    history.value = data.history
  } finally {
    loading.value = false
  }
})

function goTyping(taskId: number) {
  router.push(`/student/typing/${taskId}`)
}

function fmtMode(t: TaskDto): string {
  return t.mode === 'time' ? `限时 ${t.durationSeconds}s` : '整篇'
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}
</script>

<template>
  <div v-loading="loading" class="my-tasks">
    <h3>进行中的任务</h3>
    <el-empty v-if="!active.length" description="暂无进行中的任务" />
    <el-row v-else :gutter="16" data-testid="active-cards">
      <el-col v-for="t in active" :key="t.id" :span="8" style="margin-bottom: 16px">
        <el-card shadow="hover" :data-testid="`task-card-${t.id}`">
          <template #header>
            <b>{{ t.title }}</b>
          </template>
          <p>班级：{{ t.className ?? '-' }}</p>
          <p>
            文章：{{ t.text.title }}（{{ t.text.language === 'zh' ? '中文' : '英文' }} /
            {{ t.text.charCount }} 字）
          </p>
          <p>模式：{{ fmtMode(t) }}</p>
          <p>要求：速度 ≥ {{ t.minSpeed }} 字/分，准确率 ≥ {{ t.minAccuracy }}%</p>
          <p>截止：{{ fmtTime(t.deadline) }}</p>
          <el-button type="primary" @click="goTyping(t.id)">去练习</el-button>
        </el-card>
      </el-col>
    </el-row>

    <h3>历史任务</h3>
    <el-table :data="history" data-testid="history-table">
      <el-table-column prop="title" label="任务" min-width="160" />
      <el-table-column label="模式" width="110">
        <template #default="{ row }">{{ fmtMode(row) }}</template>
      </el-table-column>
      <el-table-column label="我的速度" width="110">
        <template #default="{ row }">
          {{ row.myRecord ? Number(row.myRecord.speed).toFixed(1) : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="准确率" width="100">
        <template #default="{ row }">
          {{ row.myRecord ? Number(row.myRecord.accuracy).toFixed(1) + '%' : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="达标" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.myRecord?.isPassed === true" type="success">达标</el-tag>
          <el-tag v-else-if="row.myRecord?.isPassed === false" type="danger">未达标</el-tag>
          <el-tag v-else type="info">未完成</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="完成时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.myRecord?.createdAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.my-tasks p {
  margin: 4px 0;
  color: #606266;
  font-size: 13px;
}
h3 {
  margin: 8px 0 16px;
}
</style>

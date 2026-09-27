<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import request from '@/utils/request'

interface DashboardData {
  classCount: number
  studentCount: number
  activeTaskCount: number
  avgSpeed: number | string | null
}

const loading = ref(false)
const data = ref<DashboardData | null>(null)

onMounted(async () => {
  loading.value = true
  try {
    data.value = await request.get<DashboardData>('/stats/teacher-dashboard')
  } finally {
    loading.value = false
  }
})

const cards = computed(() => {
  if (!data.value) return []
  return [
    { label: '我的班级', value: String(data.value.classCount) },
    { label: '学生总数', value: String(data.value.studentCount) },
    { label: '进行中任务', value: String(data.value.activeTaskCount) },
    {
      label: '任务平均速度(字/分)',
      value: data.value.avgSpeed == null ? '—' : Number(data.value.avgSpeed).toFixed(1),
    },
  ]
})
</script>

<template>
  <div v-loading="loading">
    <h3>工作台</h3>
    <el-row :gutter="16" data-testid="dashboard-cards">
      <el-col v-for="c in cards" :key="c.label" :span="6">
        <el-card>
          <div class="stat-value">{{ c.value }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
.stat-value {
  font-size: 28px;
  font-weight: 600;
}
.stat-label {
  margin-top: 6px;
  color: #909399;
  font-size: 13px;
}
</style>

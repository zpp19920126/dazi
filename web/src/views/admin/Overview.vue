<script setup lang="ts">
import { onMounted, ref } from 'vue'
import request from '@/utils/request'

interface Overview {
  teacherCount: number
  studentCount: number
  classCount: number
  recordCount: number
  todayActive: number
}

const loading = ref(false)
const data = ref<Overview | null>(null)

const cards = [
  { key: 'teacherCount', label: '教师数', color: '#409eff' },
  { key: 'studentCount', label: '学生数', color: '#67c23a' },
  { key: 'classCount', label: '班级数', color: '#e6a23c' },
  { key: 'recordCount', label: '累计练习次数', color: '#909399' },
  { key: 'todayActive', label: '今日活跃', color: '#f56c6c' },
] as const

onMounted(async () => {
  loading.value = true
  try {
    data.value = await request.get<Overview>('/stats/admin-overview')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-loading="loading">
    <h3>系统概览</h3>
    <el-row v-if="data" :gutter="16" data-testid="overview-cards">
      <el-col v-for="c in cards" :key="c.key" :span="4">
        <el-card shadow="never">
          <div style="color: #909399; font-size: 13px">{{ c.label }}</div>
          <div :style="{ fontSize: '28px', fontWeight: 600, color: c.color }">
            {{ data[c.key] }}
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

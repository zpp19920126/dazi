<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/utils/request'

interface LiveStudent {
  id: number
  realName: string
  username: string
  online: boolean
  hb: {
    status: 'typing' | 'paused' | 'finished'
    speed: string
    accuracy: string
    progress: number
    elapsedSeconds: number
    updatedAt: string
  } | null
}

const route = useRoute()
const router = useRouter()
const classId = computed(() => Number(route.params.classId))

const loading = ref(false)
const students = ref<LiveStudent[]>([])
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  loading.value = true
  try {
    students.value = await request.get<LiveStudent[]>(`/classes/${classId.value}/live`)
  } finally {
    loading.value = false
  }
}

// 状态徽章：优先离线判定，再按心跳 status
function badge(s: LiveStudent): { text: string; type: 'success' | 'warning' | 'info' } {
  if (!s.online) return { text: '离线', type: 'info' }
  if (!s.hb) return { text: '未开始', type: 'info' }
  if (s.hb.status === 'typing') return { text: '打字中', type: 'success' }
  if (s.hb.status === 'paused') return { text: '暂停', type: 'warning' }
  return { text: '已完成', type: 'info' }
}

function progressOf(s: LiveStudent): number {
  if (!s.hb) return 0
  return Math.min(100, Math.round(s.hb.progress))
}

onMounted(() => {
  load()
  // 30s 轮询实时状态
  timer = setInterval(load, 30_000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div v-loading="loading">
    <h3>
      实时看板
      <el-button style="margin-left: 12px" @click="router.push('/teacher/tasks')">
        返回任务
      </el-button>
    </h3>

    <el-empty v-if="students.length === 0" description="该班级暂无学生" />

    <el-row :gutter="16" data-testid="live-grid">
      <el-col v-for="s in students" :key="s.id" :span="6" style="margin-bottom: 16px">
        <el-card shadow="hover">
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span style="font-weight: 600">{{ s.realName }}</span>
            <el-tag :type="badge(s).type" size="small">{{ badge(s).text }}</el-tag>
          </div>
          <template v-if="s.hb">
            <div style="margin-top: 10px; color: #606266; font-size: 13px">
              速度 {{ Number(s.hb.speed).toFixed(1) }} 字/分 · 准确率
              {{ Number(s.hb.accuracy).toFixed(1) }}%
            </div>
            <el-progress
              :percentage="progressOf(s)"
              :stroke-width="10"
              style="margin-top: 8px"
            />
          </template>
          <div v-else style="margin-top: 10px; color: #c0c4cc; font-size: 13px">暂无心跳数据</div>
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

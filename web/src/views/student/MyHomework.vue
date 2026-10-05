<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'

interface MySub {
  id: number
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
}
interface Row {
  id: number
  title: string
  content: string
  dueAt: string
  status: 'published' | 'closed'
  allowAttachment: boolean
  klass: { name: string }
  mySubmission: MySub | null
}

const router = useRouter()
const rows = ref<Row[]>([])
const loading = ref(false)

type State = { text: string; type: 'success' | 'warning' | 'info' | 'danger' | 'primary' }
function stateOf(r: Row): State {
  const now = Date.now()
  // score 可能是 '0.00'：用 != null 判断，0 分也是已批改
  if (r.mySubmission && r.mySubmission.score != null) return { text: '已批改', type: 'primary' }
  if (r.mySubmission) return { text: '已提交·待批改', type: 'success' }
  if (r.status === 'published' && now <= new Date(r.dueAt).getTime()) {
    return { text: '进行中', type: 'warning' }
  }
  return { text: '已截止·未提交', type: 'danger' }
}

function remain(r: Row): string {
  const ms = new Date(r.dueAt).getTime() - Date.now()
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const d = Math.floor(ms / 86_400_000)
  return d >= 1 ? `剩余 ${d} 天` : `剩余 ${h} 小时`
}

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: Row[] }>('/homeworks', {
      params: { page: 1, pageSize: 50 },
    })
    rows.value = data.list
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>我的作业</h3>
    <div class="cards">
      <el-card
        v-for="r in rows"
        :key="r.id"
        class="card"
        shadow="hover"
        :data-testid="`hw-card-${r.id}`"
        @click="router.push(`/student/homework/${r.id}`)"
      >
        <div class="row1">
          <strong>{{ r.title }}</strong>
          <el-tag :type="stateOf(r).type" size="small">{{ stateOf(r).text }}</el-tag>
        </div>
        <div class="row2">{{ r.klass.name }} · 截止 {{ new Date(r.dueAt).toLocaleString('zh-CN', { hour12: false }) }}</div>
        <div v-if="stateOf(r).text === '进行中'" class="remain">{{ remain(r) }}</div>
        <div v-if="r.mySubmission && r.mySubmission.score != null" class="grade">
          得分 {{ Number(r.mySubmission.score) }}
          <span v-if="r.mySubmission.teacherComment" class="cmt">{{ r.mySubmission.teacherComment }}</span>
        </div>
      </el-card>
    </div>
    <el-empty v-if="!loading && !rows.length" description="暂无作业" />
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.row1 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.row2 {
  color: #909399;
  font-size: 13px;
}
.remain {
  color: #e6a23c;
  font-size: 13px;
  margin-top: 6px;
}
.grade {
  margin-top: 6px;
  font-weight: 600;
}
.cmt {
  font-weight: 400;
  color: #606266;
  margin-left: 8px;
}
.card {
  cursor: pointer;
}
</style>

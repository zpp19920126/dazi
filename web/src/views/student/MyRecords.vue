<script setup lang="ts">
import { onMounted, ref } from 'vue'
import request from '@/utils/request'

interface RecordItem {
  id: number
  mode: 'article' | 'time'
  speed: number | string
  accuracy: number | string
  totalChars: number
  correctChars: number
  durationSeconds: number
  isPassed: boolean | null
  createdAt: string
  task: { id: number; title: string; mode: string } | null
}

const loading = ref(false)
const list = ref<RecordItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: RecordItem[]; total: number }>('/records/mine', {
      params: { page: page.value, pageSize },
    })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

onMounted(load)

function changePage(p: number) {
  page.value = p
  load()
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}
</script>

<template>
  <div v-loading="loading">
    <h3>我的成绩</h3>
    <el-table :data="list" data-testid="records-table">
      <el-table-column label="来源" min-width="160">
        <template #default="{ row }">{{ row.task ? row.task.title : '自由练习' }}</template>
      </el-table-column>
      <el-table-column label="模式" width="90">
        <template #default="{ row }">{{ row.mode === 'time' ? '限时' : '整篇' }}</template>
      </el-table-column>
      <el-table-column label="速度(字/分)" width="110">
        <template #default="{ row }">{{ Number(row.speed).toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="准确率" width="100">
        <template #default="{ row }">{{ Number(row.accuracy).toFixed(1) }}%</template>
      </el-table-column>
      <el-table-column prop="correctChars" label="正确字符" width="100" />
      <el-table-column prop="totalChars" label="总字符" width="90" />
      <el-table-column prop="durationSeconds" label="用时(s)" width="90" />
      <el-table-column label="达标" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.isPassed === true" type="success">达标</el-tag>
          <el-tag v-else-if="row.isPassed === false" type="danger">未达标</el-tag>
          <el-tag v-else type="info">-</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      style="margin-top: 16px"
      @current-change="changePage"
    />
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

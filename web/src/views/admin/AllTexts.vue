<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface TextItem {
  id: number
  title: string
  language: 'zh' | 'en'
  difficulty: number
  charCount: number
  status: 'published' | 'offline'
  createdBy: number | null
  createdAt: string
}

const loading = ref(false)
const list = ref<TextItem[]>([])
const page = ref(1)
const pageSize = 10
const total = ref(0)
// 筛选：来源 tab + 语言下拉
const tab = ref<'all' | 'builtin' | 'custom'>('all')
const language = ref<'' | 'zh' | 'en'>('')

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: page.value, pageSize }
    if (tab.value !== 'all') params.source = tab.value
    if (language.value) params.language = language.value
    const data = await request.get<{ list: TextItem[]; total: number }>('/texts', { params })
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

// 下架 / 恢复（仅状态切换）
async function setStatus(row: TextItem, status: 'published' | 'offline') {
  await request.patch(`/texts/${row.id}/status`, { status })
  ElMessage.success(status === 'offline' ? '已下架' : '已恢复上架')
  await load()
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>全局文章库</h3>

    <div style="margin-bottom: 16px; display: flex; gap: 12px; align-items: center">
      <el-radio-group v-model="tab" @change="search">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="builtin">内置</el-radio-button>
        <el-radio-button value="custom">教师自建</el-radio-button>
      </el-radio-group>
      <el-select v-model="language" placeholder="语言" style="width: 120px" clearable @change="search">
        <el-option label="中文" value="zh" />
        <el-option label="英文" value="en" />
      </el-select>
    </div>

    <el-table :data="list" data-testid="all-texts-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column label="语言" width="90">
        <template #default="{ row }">
          <el-tag>{{ row.language === 'zh' ? '中文' : '英文' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="difficulty" label="难度" width="80" />
      <el-table-column prop="charCount" label="字符数" width="100" />
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          {{ row.createdBy === null ? '内置' : '教师自建' }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'published'" type="success">上架</el-tag>
          <el-tag v-else type="info">下架</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'published'"
            link
            type="warning"
            @click="setStatus(row, 'offline')"
          >
            下架
          </el-button>
          <el-button v-else link type="success" @click="setStatus(row, 'published')">
            恢复
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
  </div>
</template>

<style scoped>
h3 {
  margin: 8px 0 16px;
}
</style>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface TextItem {
  id: number
  title: string
  language: 'zh' | 'en'
  difficulty: number
  charCount: number
  createdAt: string
}

const loading = ref(false)
const list = ref<TextItem[]>([])
const page = ref(1)
const pageSize = 10
const total = ref(0)

// 新建 / 编辑共用弹窗（editingId 为 null 表示新建）
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const submitting = ref(false)
const form = reactive({
  title: '',
  language: 'zh' as 'zh' | 'en',
  difficulty: 3,
  content: '',
})

const contentLength = () => [...form.content].length

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: TextItem[]; total: number }>('/texts', {
      params: { source: 'custom', page: page.value, pageSize },
    })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.title = ''
  form.language = 'zh'
  form.difficulty = 3
  form.content = ''
  dialogVisible.value = true
}

function openEdit(row: TextItem) {
  editingId.value = row.id
  dialogVisible.value = true
  loadDetail(row.id)
}

// 编辑回显需要完整 content，列表接口通常已含 content，缺失时兜底拉详情
async function loadDetail(id: number) {
  const detail = await request.get<TextItem & { content: string }>(`/texts/${id}`).catch(() => null)
  if (detail) {
    form.title = detail.title
    form.language = detail.language
    form.difficulty = detail.difficulty
    form.content = detail.content
  }
}

async function submit() {
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning('请填写标题与正文内容')
    return
  }
  submitting.value = true
  try {
    const payload = {
      title: form.title.trim(),
      language: form.language,
      difficulty: form.difficulty,
      content: form.content,
    }
    if (editingId.value === null) {
      await request.post('/texts', payload)
      ElMessage.success('文章已创建')
    } else {
      await request.patch(`/texts/${editingId.value}`, payload)
      ElMessage.success('文章已更新')
    }
    dialogVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: TextItem) {
  await ElMessageBox.confirm(`确定删除文章「${row.title}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => null)
  await request.delete(`/texts/${row.id}`)
  ElMessage.success('已删除')
  await load()
}

function fmtTime(s?: string | null): string {
  return s ? s.slice(0, 19).replace('T', ' ') : '-'
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>自建文章</h3>
    <div style="margin-bottom: 16px">
      <el-button data-testid="create-text-btn" type="primary" @click="openCreate">
        新建文章
      </el-button>
    </div>

    <el-table :data="list" data-testid="texts-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="title" label="标题" min-width="200" />
      <el-table-column label="语言" width="90">
        <template #default="{ row }">
          <el-tag>{{ row.language === 'zh' ? '中文' : '英文' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="difficulty" label="难度" width="80" />
      <el-table-column prop="charCount" label="字符数" width="100" />
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
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

    <el-dialog
      v-model="dialogVisible"
      :title="editingId === null ? '新建文章' : '编辑文章'"
      width="720px"
    >
      <el-form label-width="70px" data-testid="text-dialog">
        <el-form-item label="标题">
          <el-input
            v-model="form.title"
            data-testid="text-title"
            maxlength="200"
            placeholder="文章标题"
          />
        </el-form-item>
        <el-form-item label="语言">
          <el-radio-group v-model="form.language">
            <el-radio value="zh">中文</el-radio>
            <el-radio value="en">英文</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="难度">
          <el-input-number v-model="form.difficulty" :min="1" :max="5" />
        </el-form-item>
        <el-form-item label="正文">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="10"
            data-testid="text-content"
            placeholder="文章内容"
          />
          <div style="margin-top: 4px; color: #909399; font-size: 12px">
            字符数：{{ contentLength() }}
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button data-testid="text-submit" type="primary" :loading="submitting" @click="submit">
          保存
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

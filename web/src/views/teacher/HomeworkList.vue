<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface Klass {
  id: number
  name: string
  studentCount: number
}
interface HwRow {
  id: number
  title: string
  classId: number
  className: string
  dueAt: string
  status: 'published' | 'closed'
  allowAttachment: boolean
  submissionCount: number
  studentCount: number
  gradedCount: number
}

const classes = ref<Klass[]>([])
const rows = ref<HwRow[]>([])
const total = ref(0)
const page = ref(1)
const filterClass = ref<number | undefined>(undefined)
const filterStatus = ref('')
const loading = ref(false)

const create = reactive({
  visible: false,
  classId: undefined as number | undefined,
  title: '',
  content: '',
  dueAt: '',
  allowAttachment: false,
})

async function refresh() {
  loading.value = true
  try {
    const data = await request.get<{ list: HwRow[]; total: number }>('/homeworks', {
      params: {
        page: page.value,
        pageSize: 20,
        classId: filterClass.value ?? undefined,
        status: filterStatus.value || undefined,
      },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  create.visible = true
  create.classId = filterClass.value ?? classes.value[0]?.id
}

async function submitCreate() {
  if (!create.classId || !create.title.trim() || !create.dueAt) {
    ElMessage.warning('班级、标题、截止时间必填')
    return
  }
  await request.post('/homeworks', {
    classId: create.classId,
    title: create.title.trim(),
    content: create.content,
    dueAt: create.dueAt,
    allowAttachment: create.allowAttachment,
  })
  ElMessage.success('已布置')
  create.visible = false
  create.title = ''
  create.content = ''
  create.dueAt = ''
  await refresh()
}

async function closeHw(row: HwRow) {
  try {
    await ElMessageBox.confirm(
      '截止后学生只能补交（计为迟交），并自动发放按时提交积分。确认截止？',
      '截止作业',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await request.patch(`/homeworks/${row.id}`, { status: 'closed' })
  ElMessage.success('已截止')
  await refresh()
}

async function exportCsv(row: HwRow) {
  const blob = await request.get<Blob>(`/homeworks/${row.id}/grades`, {
    params: { export: 'csv' },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${row.title}-成绩.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

onMounted(async () => {
  const data = await request.get<{ list: Klass[] }>('/classes')
  classes.value = data.list
  await refresh()
})

defineExpose({ create, filterStatus, refresh })
</script>

<template>
  <div v-loading="loading">
    <h3>作业管理</h3>
    <div class="bar">
      <el-select
        v-model="filterClass"
        clearable
        placeholder="全部班级"
        style="width: 200px"
        @change="refresh"
      >
        <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select
        v-model="filterStatus"
        clearable
        placeholder="全部状态"
        style="width: 140px"
        @change="refresh"
      >
        <el-option label="进行中" value="published" />
        <el-option label="已截止" value="closed" />
      </el-select>
      <el-button type="primary" data-testid="open-create" @click="openCreate">布置作业</el-button>
    </div>

    <el-table :data="rows" data-testid="homework-table" border>
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column label="班级" width="140">
        <template #default="{ row }">{{ row.className }}</template>
      </el-table-column>
      <el-table-column label="截止" width="180">
        <template #default="{ row }">{{ fmt(row.dueAt) }}</template>
      </el-table-column>
      <el-table-column label="提交" width="90">
        <template #default="{ row }">{{ row.submissionCount }}/{{ row.studentCount }}</template>
      </el-table-column>
      <el-table-column label="待批改" width="90">
        <template #default="{ row }">待批改 {{ row.submissionCount - row.gradedCount }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
            {{ row.status === 'published' ? '进行中' : '已截止' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230">
        <template #default="{ row }">
          <router-link :to="`/teacher/homeworks/${row.id}/grading`">
            <el-button link type="primary" size="small" :data-testid="`grade-link-${row.id}`">
              批改
            </el-button>
          </router-link>
          <el-button
            link
            type="success"
            size="small"
            :data-testid="`export-csv-${row.id}`"
            @click="exportCsv(row)"
          >
            导出
          </el-button>
          <el-button
            v-if="row.status === 'published'"
            link
            type="warning"
            size="small"
            :data-testid="`close-hw-${row.id}`"
            @click="closeHw(row)"
          >
            截止
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      style="margin-top: 12px"
      layout="prev, pager, next"
      :total="total"
      :page-size="20"
      @current-change="refresh"
    />

    <el-dialog v-model="create.visible" title="布置作业" width="520px">
      <el-form label-width="80px">
        <el-form-item label="班级">
          <el-select v-model="create.classId" style="width: 100%">
            <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="create.title" data-testid="form-title" maxlength="200" />
        </el-form-item>
        <el-form-item label="要求">
          <el-input
            v-model="create.content"
            type="textarea"
            :rows="4"
            data-testid="form-content"
            maxlength="10000"
          />
        </el-form-item>
        <el-form-item label="截止">
          <el-date-picker
            data-testid="form-due"
            type="datetime"
            :model-value="create.dueAt"
            @update:model-value="(v: unknown) => (create.dueAt = v instanceof Date ? v.toISOString() : '')"
          />
        </el-form-item>
        <el-form-item label="允许附件">
          <el-switch v-model="create.allowAttachment" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" data-testid="form-submit" @click="submitCreate">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
</style>

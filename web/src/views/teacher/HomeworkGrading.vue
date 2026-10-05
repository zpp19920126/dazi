<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface FileItem {
  id: number
  originalName: string
  sizeBytes: number
}
interface Sub {
  id: number
  userId: number
  realName: string
  username: string
  textContent: string
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
  files: FileItem[]
}
interface Detail {
  homework: {
    id: number
    title: string
    content: string
    dueAt: string
    status: string
  }
  studentCount: number
  submissions: Sub[]
}

const route = useRoute()
const hwId = Number(route.params.id)

const detail = ref<Detail | null>(null)
const picked = ref<Sub | null>(null)
const score = ref<number | undefined>(undefined)
const comment = ref('')
const loading = ref(false)

const header = computed(() => {
  const d = detail.value
  if (!d) return ''
  const submitted = d.submissions.length
  return `${d.homework.title} · ${d.studentCount} 人 · 已交 ${submitted} · 未交 ${d.studentCount - submitted}`
})

async function load() {
  loading.value = true
  try {
    detail.value = await request.get<Detail>(`/homeworks/${hwId}`)
    if (picked.value) {
      const again = detail.value.submissions.find((s) => s.id === picked.value?.id)
      if (again) pick(again)
      else picked.value = null
    }
  } finally {
    loading.value = false
  }
}

function pick(s: Sub) {
  picked.value = s
  // score 可能是 '0.00'：用 != null 判断，0 分必须回显 0 而非视为未批改
  score.value = s.score != null ? Number(s.score) : undefined
  comment.value = s.teacherComment ?? ''
}

async function save() {
  if (!picked.value || score.value == null) {
    ElMessage.warning('请先选择提交并填写分数')
    return
  }
  await request.patch(`/homework/submissions/${picked.value.id}/grade`, {
    score: score.value,
    comment: comment.value || undefined,
  })
  ElMessage.success('已保存批改')
  await load()
}

async function downloadFile(f: FileItem) {
  const blob = await request.get<Blob>(`/files/${f.id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.originalName
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>{{ header }}</h3>
    <div class="layout">
      <div class="list" data-testid="submission-list">
        <div
          v-for="s in detail?.submissions"
          :key="s.id"
          class="item"
          :class="{ active: picked?.id === s.id }"
          @click="pick(s)"
        >
          <span :data-testid="`pick-${s.id}`">{{ s.realName }}</span>
          <el-tag :type="s.isLate ? 'warning' : 'success'" size="small">
            {{ s.isLate ? '迟交' : '按时' }}
          </el-tag>
          <el-tag v-if="s.score != null" type="success" size="small">{{ s.score }}分</el-tag>
          <el-tag v-else size="small">未批</el-tag>
        </div>
        <el-empty v-if="detail && !detail.submissions.length" description="暂无提交" />
      </div>

      <div class="panel" data-testid="grade-panel">
        <template v-if="picked">
          <h4>
            {{ picked.realName }}（{{ picked.username }}）· 提交于
            {{ new Date(picked.submittedAt).toLocaleString('zh-CN', { hour12: false }) }}
          </h4>
          <pre class="body">{{ picked.textContent ?? '' }}</pre>
          <div v-if="picked.files.length" class="files">
            附件：
            <el-button
              v-for="f in picked.files"
              :key="f.id"
              link
              type="primary"
              size="small"
              :data-testid="`file-dl-${f.id}`"
              @click="downloadFile(f)"
            >
              {{ f.originalName }}（{{ Math.round(f.sizeBytes / 1024) }}KB）
            </el-button>
          </div>
          <el-form label-width="60px" style="margin-top: 16px">
            <el-form-item label="分数">
              <el-input-number v-model="score" :min="0" :max="100" data-testid="grade-score" />
            </el-form-item>
            <el-form-item label="点评">
              <el-input
                v-model="comment"
                type="textarea"
                :rows="3"
                maxlength="500"
                placeholder="点评（可空；留空保存将清空原点评）"
                data-testid="grade-comment"
              />
            </el-form-item>
            <el-button type="primary" data-testid="grade-save" @click="save">保存批改</el-button>
          </el-form>
        </template>
        <el-empty v-else description="选择左侧提交进行批改" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
}
.list {
  width: 260px;
  border-right: 1px solid #ebeef5;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.item.active {
  background: #ecf5ff;
}
.panel {
  flex: 1;
}
.body {
  white-space: pre-wrap;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface MySub {
  id: number
  textContent: string
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
  files: { id: number; originalName: string; sizeBytes: number }[]
}
interface Detail {
  homework: {
    id: number
    title: string
    content: string
    dueAt: string
    status: 'published' | 'closed'
    allowAttachment: boolean
  }
  mySubmission: MySub | null
}

const route = useRoute()
const router = useRouter()
const hwId = Number(route.params.id)

const detail = ref<Detail | null>(null)
const text = ref('')
const files = ref<File[]>([])
const sending = ref(false)

const pastDue = computed(() => (detail.value ? Date.now() > new Date(detail.value.homework.dueAt).getTime() : false))

async function load() {
  detail.value = await request.get<Detail>(`/homeworks/${hwId}`)
  if (detail.value.mySubmission) {
    text.value = detail.value.mySubmission.textContent ?? text.value
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  files.value = Array.from(input.files ?? [])
}

async function send() {
  if (!text.value.trim()) {
    ElMessage.warning('请填写作业内容')
    return
  }
  sending.value = true
  try {
    // multipart：文本字段 textContent + 文件字段 files（对应后端 FilesInterceptor('files')）
    const fd = new FormData()
    fd.append('textContent', text.value)
    for (const f of files.value) fd.append('files', f)
    await request.post(`/homeworks/${hwId}/submissions`, fd)
    ElMessage.success('已提交')
    files.value = []
    await load()
  } finally {
    sending.value = false
  }
}

async function downloadFile(id: number, name: string) {
  const blob = await request.get<Blob>(`/files/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div v-if="detail">
    <h3>
      {{ detail.homework.title }}
      <el-tag v-if="pastDue" type="danger" size="small">已截止，补交计为迟交</el-tag>
    </h3>
    <pre class="requirement">{{ detail.homework.content }}</pre>

    <div v-if="detail.mySubmission" class="last" data-testid="last-submission">
      <p>
        最近提交：{{ new Date(detail.mySubmission.submittedAt).toLocaleString('zh-CN', { hour12: false }) }}
        · {{ detail.mySubmission.isLate ? '迟交' : '按时' }}
        <template v-if="detail.mySubmission.score != null">
          · 得分 {{ Number(detail.mySubmission.score) }}（{{ detail.mySubmission.teacherComment }}）
        </template>
      </p>
      <p v-if="!pastDue" class="hint">截止前可重交，以最后一次为准</p>
      <div v-if="detail.mySubmission.files.length">
        <el-button
          v-for="f in detail.mySubmission.files"
          :key="f.id"
          link
          type="primary"
          size="small"
          @click="downloadFile(f.id, f.originalName)"
        >
          {{ f.originalName }}
        </el-button>
      </div>
    </div>

    <el-input v-model="text" type="textarea" :rows="8" maxlength="50000" data-testid="content-input" placeholder="作业内容…" />
    <div v-if="detail.homework.allowAttachment" class="attach">
      <input type="file" multiple data-testid="file-input" @change="onFileChange" />
      <span class="hint">单文件 ≤10MB，最多 3 个（jpg/png/pdf/doc/docx/zip）</span>
    </div>
    <div class="actions">
      <el-button @click="router.push('/student/homework')">返回</el-button>
      <el-button type="primary" :loading="sending" data-testid="send-submit" @click="send">
        {{ detail.mySubmission ? '重新提交' : '提交作业' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.requirement {
  white-space: pre-wrap;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
}
.attach {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  color: #909399;
  font-size: 13px;
}
.actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
.last {
  margin-bottom: 12px;
}
</style>

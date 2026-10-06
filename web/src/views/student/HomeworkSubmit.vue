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
const fileInput = ref<HTMLInputElement>()
const sending = ref(false)

// 与后端 MAX_FILES / MAX_FILE_BYTES 同值（400/413 的服务端校验仍是最终防线）
const MAX_FILES_UI = 10
const MAX_FILE_BYTES_UI = 10 * 1024 * 1024

const pastDue = computed(() => (detail.value ? Date.now() > new Date(detail.value.homework.dueAt).getTime() : false))

async function load() {
  detail.value = await request.get<Detail>(`/homeworks/${hwId}`)
  if (detail.value.mySubmission) {
    text.value = detail.value.mySubmission.textContent ?? text.value
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const seen = new Set(files.value.map((f) => `${f.name}:${f.size}`))
  let overCount = false
  const skipped: string[] = []
  for (const f of Array.from(input.files ?? [])) {
    if (f.size > MAX_FILE_BYTES_UI) {
      skipped.push(f.name)
      continue
    }
    const key = `${f.name}:${f.size}`
    if (seen.has(key)) continue
    if (files.value.length >= MAX_FILES_UI) {
      overCount = true
      break
    }
    seen.add(key)
    files.value.push(f)
  }
  if (skipped.length) ElMessage.warning(`超过 10MB 已跳过：${skipped.join('、')}`)
  if (overCount) ElMessage.warning(`最多 ${MAX_FILES_UI} 个附件，超出部分未添加`)
  // 组件自管已选列表：重置原生框，便于继续追加选择
  input.value = ''
}

function removeFile(i: number) {
  files.value.splice(i, 1)
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
    if (fileInput.value) fileInput.value.value = '' // 清空原生选择框的文件名显示
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
  // 同步 revoke 会掐断 Firefox 等引擎尚未开始的下载
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
      <input ref="fileInput" type="file" multiple data-testid="file-input" @change="onFileChange" />
      <span class="hint">单文件 ≤10MB，最多 10 个（jpg/png/pdf/doc/docx/zip）；可分多次选择</span>
      <div v-if="files.length" class="picked">
        <div
          v-for="(f, i) in files"
          :key="`${f.name}-${f.size}-${i}`"
          class="picked-item"
          :data-testid="`picked-file-${i}`"
        >
          <span>{{ f.name }}（{{ Math.round(f.size / 1024) }}KB）</span>
          <el-button link type="danger" size="small" @click="removeFile(i)">移除</el-button>
        </div>
      </div>
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
  flex-wrap: wrap;
}
.picked {
  width: 100%;
}
.picked-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
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

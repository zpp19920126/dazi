<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface FileItem {
  id: number
  originalName: string
  mimeType: string
  sizeBytes: number
}
interface Row {
  userId: number
  realName: string
  username: string
  submittedAt: string | null
  state: '未交' | '迟交' | '按时'
  score: number | null
  teacherComment: string
  submissionId: number | null
  textContent: string | null
  files: FileItem[]
}
interface Stats {
  submitted: number
  graded: number
  late: number
  unsubmitted: number
}
interface GradesData {
  list: (Omit<Row, 'teacherComment'> & { teacherComment: string | null })[]
  total: number
  stats: Stats
}
interface Brief {
  homework: {
    id: number
    title: string
    content: string
    dueAt: string
    status: string
  }
}

const route = useRoute()
const hwId = Number(route.params.id)

const brief = ref<Brief | null>(null)
const rows = ref<Row[]>([])
const meta = ref<{ total: number; stats: Stats } | null>(null)
const loading = ref(false)
const tableWrap = ref<HTMLElement>()
const expandedIds = ref<number[]>([])

const imgUrls = reactive<Record<number, string>>({})
const imgRequested = new Set<number>()

// 服务端快照：脏检查/失败回滚/轮询合并的基准
const snap = new Map<number, { score: number | null; comment: string }>()
const savingIds = new Set<number>()

const header = computed(() => {
  const b = brief.value
  const m = meta.value
  if (!b || !m) return ''
  return `${b.homework.title} · ${m.total} 人 · 已交 ${m.stats.submitted} · 未交 ${m.stats.unsubmitted} · 已批 ${m.stats.graded}`
})

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—'

const isImage = (f: FileItem) => f.mimeType.startsWith('image/')

function isDirty(r: Row): boolean {
  const s = snap.get(r.userId)
  if (!s) return false
  return r.score !== s.score || r.teacherComment !== s.comment
}

function applyGrades(g: GradesData) {
  const prev = new Map(rows.value.map((r) => [r.userId, r]))
  const next: Row[] = g.list.map((r) => {
    const merged: Row = { ...r, teacherComment: r.teacherComment ?? '' }
    const old = prev.get(r.userId)
    // 未保存的输入不被轮询覆盖
    if (old && isDirty(old)) {
      merged.score = old.score
      merged.teacherComment = old.teacherComment
    }
    return merged
  })
  for (const r of g.list) snap.set(r.userId, { score: r.score, comment: r.teacherComment ?? '' })
  rows.value = next
  meta.value = { total: g.total, stats: g.stats }
  syncImages(next)
}

async function fetchImage(id: number) {
  try {
    const blob = await request.get<Blob>(`/files/${id}/download`, { responseType: 'blob' })
    imgUrls[id] = URL.createObjectURL(blob)
  } catch {
    imgUrls[id] = ''
  }
}

function syncImages(rows: Row[]) {
  const want = new Set(rows.flatMap((r) => r.files).filter(isImage).map((f) => f.id))
  for (const id of [...imgRequested]) {
    if (!want.has(id)) {
      if (imgUrls[id]) URL.revokeObjectURL(imgUrls[id])
      delete imgUrls[id]
      imgRequested.delete(id)
    }
  }
  const fresh = [...want].filter((id) => !imgRequested.has(id))
  fresh.forEach((id) => imgRequested.add(id))
  // 并发限 3 逐批拉取，失败显示加载失败可重进页面重试
  void (async () => {
    for (let i = 0; i < fresh.length; i += 3) {
      await Promise.all(fresh.slice(i, i + 3).map((id) => fetchImage(id)))
    }
  })()
}

async function loadGrades() {
  const g = await request.get<GradesData>(`/homeworks/${hwId}/grades?pageSize=100`)
  applyGrades(g)
}

async function load() {
  loading.value = true
  try {
    const [b] = await Promise.all([request.get<Brief>(`/homeworks/${hwId}`), loadGrades()])
    brief.value = b
  } finally {
    loading.value = false
  }
}

async function saveRow(r: Row) {
  if (!r.submissionId || savingIds.has(r.userId) || !isDirty(r)) return
  if (r.score == null) {
    ElMessage.warning(`${r.realName}：请先填写分数`)
    return
  }
  savingIds.add(r.userId)
  try {
    await request.patch(`/homework/submissions/${r.submissionId}/grade`, {
      score: r.score,
      comment: r.teacherComment.trim() ? r.teacherComment : undefined,
    })
    snap.set(r.userId, { score: r.score, comment: r.teacherComment })
    ElMessage.success(`已保存 ${r.realName}`)
  } catch {
    const s = snap.get(r.userId)
    if (s) {
      r.score = s.score
      r.teacherComment = s.comment
    }
    ElMessage.error(`保存失败：${r.realName}`)
  } finally {
    savingIds.delete(r.userId)
  }
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

const previewList = (row: Row) =>
  row.files.filter(isImage).map((f) => imgUrls[f.id]).filter(Boolean)
const imageIndex = (row: Row, id: number) =>
  row.files.filter(isImage).filter((f) => imgUrls[f.id]).findIndex((f) => f.id === id)

const toggleExpand = (userId: number) => {
  const i = expandedIds.value.indexOf(userId)
  if (i >= 0) expandedIds.value.splice(i, 1)
  else expandedIds.value.push(userId)
}

let timer: number | undefined
function tick() {
  if (document.hidden) return
  // 焦点在表格内（正在输入/选择）时跳过本轮
  if (tableWrap.value?.contains(document.activeElement)) return
  void loadGrades().catch(() => {})
}

onMounted(() => {
  void load()
  timer = window.setInterval(tick, 30_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  for (const u of Object.values(imgUrls)) if (u) URL.revokeObjectURL(u)
})
</script>

<template>
  <div v-loading="loading">
    <h3>{{ header }}</h3>
    <div v-if="brief" class="hw-brief" data-testid="homework-info">
      <div>截止时间：{{ fmt(brief.homework.dueAt) }}</div>
      <pre class="requirement">作业要求：{{ brief.homework.content }}</pre>
    </div>
    <div ref="tableWrap" data-testid="grade-table-wrap">
      <el-table :data="rows" border data-testid="grade-table">
        <el-table-column label="姓名" width="150">
          <template #default="{ row }">{{ row.realName }}（{{ row.username }}）</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag
              :type="row.state === '未交' ? 'info' : row.state === '迟交' ? 'warning' : 'success'"
              size="small"
            >
              {{ row.state }}
            </el-tag>
            <el-tag v-if="row.score != null" type="success" size="small" class="ml6">
              {{ row.score }}分
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="165">
          <template #default="{ row }">{{ fmt(row.submittedAt) }}</template>
        </el-table-column>
        <el-table-column label="附件" min-width="210">
          <template #default="{ row }">
            <span v-if="!row.files.length" class="muted">—</span>
            <span v-for="f in row.files" :key="f.id" class="file-item">
              <span v-if="isImage(f)" :data-testid="`thumb-${f.id}`" class="thumb-wrap">
                <el-image
                  :src="imgUrls[f.id] || ''"
                  fit="cover"
                  class="thumb"
                  :preview-src-list="previewList(row)"
                  :initial-index="imageIndex(row, f.id)"
                  preview-teleported
                  hide-on-click-modal
                />
                <span v-if="imgUrls[f.id] === ''" class="muted">加载失败</span>
              </span>
              <el-button
                v-else
                link
                type="primary"
                size="small"
                :data-testid="`file-dl-${f.id}`"
                @click="downloadFile(f)"
              >
                {{ f.originalName }}（{{ Math.round(f.sizeBytes / 1024) }}KB）
              </el-button>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="文本内容" min-width="200">
          <template #default="{ row }">
            <div
              v-if="row.textContent"
              :data-testid="`text-${row.userId}`"
              :class="['hw-text', { clamped: !expandedIds.includes(row.userId) }]"
              @click="toggleExpand(row.userId)"
            >
              {{ row.textContent }}
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="130">
          <template #default="{ row }">
            <el-input-number
              v-model="row.score"
              :data-testid="`score-${row.userId}`"
              :min="0"
              :max="100"
              :step="0.5"
              :disabled="!row.submissionId"
              size="small"
              controls-position="right"
              @change="saveRow(row)"
              @blur="saveRow(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="点评" min-width="220">
          <template #default="{ row }">
            <el-input
              v-model="row.teacherComment"
              :data-testid="`comment-${row.userId}`"
              type="textarea"
              :rows="2"
              maxlength="500"
              :disabled="!row.submissionId"
              placeholder="点评（可空；清空后保存将删除原点评）"
              @blur="saveRow(row)"
            />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无学生" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.hw-brief {
  margin: 8px 0 12px;
  color: #606266;
}
.requirement {
  white-space: pre-wrap;
  margin: 4px 0 0;
  color: #606266;
}
.muted {
  color: #c0c4cc;
}
.ml6 {
  margin-left: 6px;
}
.file-item {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
}
.thumb-wrap {
  display: inline-block;
}
.thumb {
  width: 56px;
  height: 56px;
  border-radius: 4px;
  border: 1px solid #ebeef5;
  display: block;
}
.hw-text {
  white-space: pre-wrap;
  cursor: pointer;
}
.hw-text.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

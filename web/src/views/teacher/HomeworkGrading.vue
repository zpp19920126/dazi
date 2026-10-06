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
let disposed = false

const detailRow = ref<Row | null>(null)
const detailVisible = ref(false)
function openDetail(r: Row) {
  if (!r.submissionId) return
  detailRow.value = r
  detailVisible.value = true
}

// 服务端快照：脏检查/失败回滚/轮询合并的基准
const snap = new Map<number, { score: number | null; comment: string }>()
const savingIds = new Set<number>()
// 每行最近一次保存成功时间：晚于轮询发起时间的行拒绝旧响应回填
const lastSavedAt = new Map<number, number>()

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

// 点评归一化：纯空白等价于清空（服务端收到 undefined 即置 null）
const normComment = (c: string) => (c.trim() ? c : '')

function applyGrades(g: GradesData, pollStart?: number) {
  // 本轮请求发起时/之后才保存成功的行：旧响应直接丢弃，保留已保存值
  // （用 >= 覆盖同一毫秒竞态；下一轮轮询自然恢复同步）
  const freshAfterPoll = (userId: number) =>
    pollStart !== undefined && (lastSavedAt.get(userId) ?? 0) >= pollStart
  const prev = new Map(rows.value.map((r) => [r.userId, r]))
  const next: Row[] = g.list.map((r) => {
    const old = prev.get(r.userId)
    // 本轮请求发起后才保存成功的行：旧响应直接丢弃，保留已保存值
    if (old && freshAfterPoll(r.userId)) return old
    const merged: Row = { ...r, teacherComment: r.teacherComment ?? '' }
    // 未保存的输入不被轮询覆盖
    if (old && isDirty(old)) {
      merged.score = old.score
      merged.teacherComment = old.teacherComment
    }
    return merged
  })
  for (const r of g.list) {
    // 与行合并条件对称：仅对 prev 中存在的行保留 snap
    if (prev.has(r.userId) && freshAfterPoll(r.userId)) continue
    snap.set(r.userId, { score: r.score, comment: r.teacherComment ?? '' })
  }
  rows.value = next
  meta.value = { total: g.total, stats: g.stats }
  // 弹窗打开时重绑到新行对象，随轮询刷新内容；行消失则关闭弹窗
  if (detailRow.value) {
    const uid = detailRow.value.userId
    const fresh = next.find((r) => r.userId === uid)
    if (fresh) detailRow.value = fresh
    else {
      detailRow.value = null
      detailVisible.value = false
    }
  }
  syncImages(next)
}

async function fetchImage(id: number) {
  try {
    const blob = await request.get<Blob>(`/files/${id}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    // 拉取期间行已被移除或页面已卸载：立即回收，避免无人清理的泄漏
    if (!disposed && imgRequested.has(id)) imgUrls[id] = url
    else URL.revokeObjectURL(url)
  } catch {
    if (!disposed && imgRequested.has(id)) imgUrls[id] = ''
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
  const started = Date.now()
  const g = await request.get<GradesData>(`/homeworks/${hwId}/grades?pageSize=100`)
  applyGrades(g, started)
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

async function saveRow(r: Row, silent = false) {
  if (!r.submissionId || savingIds.has(r.userId) || !isDirty(r)) return
  if (r.score == null) {
    // 补发路径静默：分数是刚保存成功的那个
    if (!silent) ElMessage.warning(`${r.realName}：请先填写分数`)
    return
  }
  savingIds.add(r.userId)
  // 同步捕获待发送值：飞行中再次编辑不能被误标为已保存
  const sent = { score: r.score, comment: normComment(r.teacherComment) }
  let ok = false
  try {
    await request.patch(`/homework/submissions/${r.submissionId}/grade`, {
      score: sent.score,
      comment: sent.comment || undefined,
    })
    snap.set(r.userId, { score: sent.score, comment: sent.comment })
    lastSavedAt.set(r.userId, Date.now())
    // 归一化行值（纯空格→''），保证 行/snap/服务端 三者一致，否则脏判定永不消解；
    // 飞行期间已有新编辑时不动行值，交由 finally 补发
    if (normComment(r.teacherComment) === sent.comment) r.teacherComment = sent.comment
    ElMessage.success(`已保存 ${r.realName}`)
    ok = true
  } catch {
    const s = snap.get(r.userId)
    if (s) {
      r.score = s.score
      r.teacherComment = s.comment
    }
    ElMessage.error(`保存失败：${r.realName}`)
  } finally {
    savingIds.delete(r.userId)
    // 补发飞行期间被拦截的编辑：取当前在表中的行对象（轮询可能已换引用）
    if (ok) {
      const live = rows.value.find((x) => x.userId === r.userId)
      if (live && isDirty(live)) void saveRow(live, true)
    }
  }
}

async function downloadFile(f: FileItem) {
  const blob = await request.get<Blob>(`/files/${f.id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.originalName
  a.click()
  // 同步 revoke 会掐断 Firefox 等引擎尚未开始的下载
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  disposed = true
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
        <el-table-column label="详情" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :data-testid="`detail-${row.userId}`"
              :disabled="!row.submissionId"
              @click="openDetail(row)"
            >
              查看详情
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无学生" />
        </template>
      </el-table>
    </div>

    <el-dialog v-model="detailVisible" width="720px" :title="detailRow ? `${detailRow.realName}（${detailRow.username}）的作业详情` : ''">
      <div v-if="detailRow" data-testid="detail-dialog">
        <p class="detail-meta">
          {{ detailRow.realName }}（{{ detailRow.username }}）· {{ fmt(detailRow.submittedAt) }} ·
          {{ detailRow.state }}
          <template v-if="detailRow.score != null"> · 得分 {{ detailRow.score }}</template>
        </p>
        <pre class="full-text">{{ detailRow.textContent || '（无文本内容）' }}</pre>
        <div v-if="detailRow.files.length" class="detail-files">
          <template v-for="f in detailRow.files" :key="f.id">
            <div v-if="isImage(f)" class="dthumb" :data-testid="`dthumb-${f.id}`">
              <el-image
                :src="imgUrls[f.id] || ''"
                fit="contain"
                class="dbig"
                :preview-src-list="previewList(detailRow)"
                :initial-index="imageIndex(detailRow, f.id)"
                preview-teleported
                hide-on-click-modal
              />
              <span v-if="imgUrls[f.id] === ''" class="muted">加载失败</span>
              <span v-else class="fname">{{ f.originalName }}</span>
            </div>
            <el-button v-else link type="primary" :data-testid="`dfile-dl-${f.id}`" @click="downloadFile(f)">
              {{ f.originalName }}（{{ Math.round(f.sizeBytes / 1024) }}KB）
            </el-button>
          </template>
        </div>
        <p v-else class="muted">无附件</p>
      </div>
    </el-dialog>
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
.detail-meta {
  color: #909399;
  margin: 0 0 8px;
}
.full-text {
  white-space: pre-wrap;
  max-height: 320px;
  overflow: auto;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  margin: 0 0 12px;
}
.detail-files {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.dthumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.dbig {
  width: 160px;
  height: 120px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.fname {
  font-size: 12px;
  color: #606266;
}
</style>

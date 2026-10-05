<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface Klass {
  id: number
  name: string
  studentCount: number
}
interface Session {
  id: number
  classId: number
  period: string | null
  status: 'open' | 'closed'
  startedAt: string
  endedAt: string | null
}
interface AttRow {
  id: number
  userId: number
  realName: string
  username: string
  checkInAt: string | null
  status: string
  corrected: boolean
  note: string | null
  seated: boolean
}

const STATUS_LABEL: Record<string, { text: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  present: { text: '到课', type: 'success' },
  late: { text: '迟到', type: 'warning' },
  absent: { text: '旷课', type: 'danger' },
  excused: { text: '事假', type: 'info' },
  sick: { text: '病假', type: 'info' },
}

const classes = ref<Klass[]>([])
const classId = ref<number | null>(null)
const sessions = ref<Session[]>([])
const rows = ref<AttRow[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// 当前进行中的课次（computed 保证模板内类型安全，避免非空断言）
const openSession = computed(() => sessions.value.find((s) => s.status === 'open') ?? null)

async function refresh() {
  if (!classId.value) return
  loading.value = true
  try {
    sessions.value = (
      await request.get<{ list: Session[] }>('/sessions', {
        params: { classId: classId.value, page: 1, pageSize: 50 },
      })
    ).list
    const sid = openSession.value?.id
    rows.value = sid ? await request.get<AttRow[]>(`/sessions/${sid}/attendance`) : []
  } finally {
    loading.value = false
  }
}

async function openClass() {
  let period = ''
  try {
    const r = await ElMessageBox.prompt('节次（可留空，如：第三节）', '开课', { inputValue: '' })
    period = String(r.value ?? '')
  } catch {
    return
  }
  await request.post('/sessions', { classId: classId.value, period: period || undefined })
  ElMessage.success('已开课')
  await refresh()
}

async function closeClass() {
  const sid = openSession.value?.id
  if (!sid) return
  try {
    await ElMessageBox.confirm('结课后不再自动打卡，且自动结算全勤分。确认结课？', '结课', {
      type: 'warning',
    })
  } catch {
    return
  }
  await request.patch(`/sessions/${sid}/close`)
  ElMessage.success('已结课')
  await refresh()
}

async function correct(row: AttRow, status: string) {
  await request.patch(`/attendance/${row.id}`, { status })
  await refresh()
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(async () => {
  const data = await request.get<{ list: Klass[] }>('/classes')
  classes.value = data.list
  if (data.list.length) {
    classId.value = data.list[0].id
    await refresh()
    timer = setInterval(refresh, 30_000) // 与实时看板同口径的 30s 自刷
  }
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div v-loading="loading">
    <h3>开课考勤</h3>
    <div class="bar">
      <el-select v-model="classId" style="width: 220px" @change="refresh">
        <el-option
          v-for="c in classes"
          :key="c.id"
          :label="`${c.name}（${c.studentCount}人）`"
          :value="c.id"
        />
      </el-select>
      <template v-if="openSession">
        <span class="info">
          ● 正在上课 {{ openSession.period ?? '' }} · 开课于 {{ fmtTime(openSession.startedAt) }}
        </span>
        <el-button type="danger" @click="closeClass">结 课</el-button>
      </template>
      <el-button v-else type="primary" :disabled="!classId" @click="openClass">开 课</el-button>
    </div>

    <el-table v-if="openSession" :data="rows" data-testid="attendance-table" border>
      <el-table-column prop="realName" label="姓名" width="120" />
      <el-table-column label="打卡时间" width="110">
        <template #default="{ row }">{{ fmtTime(row.checkInAt) }}</template>
      </el-table-column>
      <el-table-column label="在座" width="80">
        <template #default="{ row }">
          <span :style="{ color: row.seated ? '#67c23a' : '#c0c4cc' }">
            {{ row.seated ? '● 在座' : '○ 不在' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="STATUS_LABEL[row.status]?.type ?? 'info'" size="small">
            {{ STATUS_LABEL[row.status]?.text ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="修正为（病假/事假/旷课/到课）">
        <template #default="{ row }">
          <el-button link type="warning" size="small" @click="correct(row, 'sick')">病假</el-button>
          <el-button link type="warning" size="small" @click="correct(row, 'excused')">
            事假
          </el-button>
          <el-button link type="danger" size="small" @click="correct(row, 'absent')">旷课</el-button>
          <el-button link type="success" size="small" @click="correct(row, 'present')">
            到课
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else-if="classId" description="当前无进行中的课次" />

    <h4 style="margin-top: 24px">历史课次</h4>
    <el-table :data="sessions.filter((s) => s.status === 'closed')" data-testid="history-table" border>
      <el-table-column label="日期" width="160">
        <template #default="{ row }">{{ new Date(row.startedAt).toLocaleDateString() }}</template>
      </el-table-column>
      <el-table-column prop="period" label="节次" width="120" />
      <el-table-column label="开课">
        <template #default="{ row }">
          {{ fmtTime(row.startedAt) }} ~ {{ fmtTime(row.endedAt) }}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.info {
  color: #67c23a;
  font-size: 14px;
}
</style>

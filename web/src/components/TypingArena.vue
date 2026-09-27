<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import { useTypingEngine } from '@/composables/useTypingEngine'
import { useHeartbeat } from '@/composables/useHeartbeat'
import PinyinBar from './PinyinBar.vue'

const props = defineProps<{
  /** 练习文本全文 */
  target: string
  mode: 'article' | 'time'
  durationSeconds: number | null
  /** 关联任务 id（自由练习传 null） */
  taskId: number | null
}>()

const emit = defineEmits<{ submitted: [] }>()

/* ---------- 引擎与心跳 ---------- */
const engine = useTypingEngine({
  target: computed(() => props.target),
  mode: props.mode,
  durationSeconds: props.durationSeconds ?? undefined,
  // time 模式倒计时归零自动交卷
  onTimeout: () => {
    void doSubmit()
  },
})
const stats = computed(() => engine.stats.value)

const hb = useHeartbeat(
  computed(() => ({
    taskId: props.taskId,
    status: stats.value.finished ? 'finished' : 'typing',
    speed: stats.value.speed,
    accuracy: stats.value.accuracy,
    progress: stats.value.progress,
    elapsedSeconds: Math.floor(stats.value.elapsedMs / 1000),
    charIndex: stats.value.charIndex,
  })),
)

/* ---------- 文章渲染：逐字符着色 ---------- */
const chars = computed(() => props.target.split(''))
const typedText = computed(() => engine.typed.value)

function cls(i: number): string {
  if (i < typedText.value.length) {
    return typedText.value[i] === props.target[i] ? 'char correct' : 'char wrong'
  }
  if (i === typedText.value.length && !stats.value.finished) return 'char cursor'
  return 'char pending'
}

/* ---------- 输入承接：隐藏 input + IME ---------- */
const inputRef = ref<HTMLInputElement>()
const pinyin = ref('')

onMounted(() => {
  inputRef.value?.focus()
  hb.onTick() // 进入练习立即上报一次心跳
})

function focusInput() {
  inputRef.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === ' ') e.preventDefault() // 防止空格滚动页面
  engine.handleKeydown(e)
}

function onCompositionUpdate(e: CompositionEvent) {
  pinyin.value = e.data ?? ''
}

function onCompositionEnd(e: CompositionEvent) {
  engine.handleCompositionEnd(e)
  pinyin.value = ''
}

/* ---------- 状态条 ---------- */
function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

const remainingMs = computed(() =>
  props.mode === 'time' && props.durationSeconds
    ? Math.max(0, props.durationSeconds * 1000 - stats.value.elapsedMs)
    : 0,
)

/* ---------- 交卷 ---------- */
const submitting = ref(false)
const result = ref<null | { isPassed: boolean | null; speed: number | string; accuracy: number | string }>(null)

async function doSubmit() {
  if (submitting.value || result.value) return
  submitting.value = true
  try {
    const s = stats.value
    const record = await request.post<{ isPassed: boolean | null; speed: number | string; accuracy: number | string }>(
      '/records',
      {
        taskId: props.taskId ?? undefined,
        mode: props.mode,
        speed: s.speed,
        accuracy: s.accuracy,
        totalChars: s.charIndex,
        correctChars: s.correctChars,
        backspaceCount: s.backspaceCount,
        durationSeconds: Math.max(1, Math.round(s.elapsedMs / 1000)),
      },
    )
    result.value = record
    hb.stop() // 交卷后停止心跳
    ElMessage.success('交卷成功')
    emit('submitted')
  } finally {
    submitting.value = false
  }
}

// article 打满 → finished → 自动交卷（不弹确认，避免挂起）；防重由 doSubmit 守卫保证
watch(
  () => stats.value.finished,
  (finished) => {
    if (finished) void doSubmit()
  },
)

async function onManualSubmit() {
  try {
    await ElMessageBox.confirm('确定要交卷吗？交卷后本次练习结束。', '交卷确认', { type: 'warning' })
  } catch {
    return // 用户取消
  }
  await doSubmit()
}

function restart() {
  result.value = null
  engine.reset()
  focusInput()
}
</script>

<template>
  <div class="typing-arena">
    <PinyinBar :pinyin="pinyin" />

    <div class="status-bar" data-testid="status-bar">
      <span>速度 <b>{{ stats.speed.toFixed(0) }}</b> 字/分</span>
      <span>准确率 <b>{{ stats.accuracy.toFixed(0) }}</b>%</span>
      <span>进度 <b>{{ stats.progress.toFixed(0) }}</b>%</span>
      <span v-if="mode === 'time'">剩余 <b>{{ fmtMs(remainingMs) }}</b></span>
      <span v-else>用时 <b>{{ fmtMs(stats.elapsedMs) }}</b></span>
    </div>

    <div class="article" data-testid="article" @click="focusInput">
      <span v-for="(ch, i) in chars" :key="i" :class="cls(i)">{{ ch }}</span>
    </div>

    <input
      ref="inputRef"
      class="hidden-input"
      autocomplete="off"
      @keydown="onKeydown"
      @compositionupdate="onCompositionUpdate"
      @compositionend="onCompositionEnd"
      @paste.prevent
    />

    <div class="actions">
      <el-button type="primary" :disabled="stats.finished" @click="onManualSubmit">交卷</el-button>
      <el-button v-if="!taskId" @click="restart">重新练习</el-button>
    </div>

    <el-card v-if="result" class="result-card" data-testid="result-card" shadow="never">
      <template #header>本次成绩</template>
      <div class="result-grid">
        <div><label>速度</label><b>{{ Number(result.speed).toFixed(0) }}</b> 字/分</div>
        <div><label>准确率</label><b>{{ Number(result.accuracy).toFixed(0) }}</b>%</div>
        <div>
          <label>达标</label>
          <el-tag v-if="result.isPassed === true" type="success">达标</el-tag>
          <el-tag v-else-if="result.isPassed === false" type="danger">未达标</el-tag>
          <span v-else>自由练习不计达标</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.typing-arena {
  max-width: 860px;
}
.status-bar {
  display: flex;
  gap: 28px;
  padding: 10px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 14px;
  color: #606266;
}
.status-bar b {
  color: #303133;
  font-size: 18px;
  margin: 0 2px;
}
.article {
  font-size: 22px;
  line-height: 1.9;
  padding: 20px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  cursor: text;
  user-select: none;
  min-height: 140px;
}
.char.pending {
  color: #909399;
}
.char.correct {
  color: #67c23a;
}
.char.wrong {
  color: #f56c6c;
  text-decoration: underline;
  background: #fef0f0;
}
.char.cursor {
  outline: 2px solid #409eff;
  background: #ecf5ff;
  color: #303133;
  border-radius: 2px;
}
.hidden-input {
  position: fixed;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  border: none;
  pointer-events: none;
}
.actions {
  margin-top: 16px;
}
.result-card {
  margin-top: 16px;
}
.result-grid {
  display: flex;
  gap: 40px;
  font-size: 15px;
  align-items: center;
}
.result-grid label {
  color: #909399;
  margin-right: 8px;
}
</style>

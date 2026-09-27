<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import TypingArena from '@/components/TypingArena.vue'

interface TextItem {
  id: number
  title: string
  language: 'en' | 'zh'
  difficulty: string
  charCount: number
  content: string
}
interface StudentTask {
  id: number
  title: string
  mode: 'article' | 'time'
  durationSeconds: number | null
  text: TextItem
}

const route = useRoute()
// /student/typing/:taskId? 有参 → 任务练习；无参 → 自由练习
const taskId = computed(() => (route.params.taskId ? Number(route.params.taskId) : null))

const loading = ref(false)
const freeTexts = ref<TextItem[]>([])
const currentTask = ref<StudentTask | null>(null)
const currentText = ref<TextItem | null>(null)
const arenaKey = ref(0)

onMounted(async () => {
  loading.value = true
  try {
    if (taskId.value) {
      // 学生任务视图已包含 text 全文，无需再取 /texts/:id
      const data = await request.get<{ active: StudentTask[]; history: StudentTask[] }>('/tasks')
      const found = [...data.active, ...data.history].find((t) => t.id === taskId.value)
      if (!found) {
        ElMessage.error('任务不存在或未发布')
        return
      }
      currentTask.value = found
    } else {
      const data = await request.get<{ list: TextItem[] }>('/texts', {
        params: { page: 1, pageSize: 20 },
      })
      freeTexts.value = data.list
    }
  } finally {
    loading.value = false
  }
})

function startFree(text: TextItem) {
  currentText.value = text
  arenaKey.value++ // 换文章强制重建 Arena（引擎以新 target 创建）
}

function backToList() {
  currentText.value = null
}
</script>

<template>
  <div v-loading="loading">
    <!-- 任务练习 -->
    <template v-if="currentTask">
      <div class="page-header">
        <h3>{{ currentTask.title }}</h3>
        <span class="sub">文章：{{ currentTask.text.title }}</span>
      </div>
      <TypingArena
        :key="`task-${currentTask.id}`"
        :target="currentTask.text.content"
        :mode="currentTask.mode"
        :duration-seconds="currentTask.durationSeconds"
        :task-id="currentTask.id"
      />
    </template>

    <!-- 自由练习：已选文章 -->
    <template v-else-if="currentText">
      <div class="page-header">
        <el-button link type="primary" @click="backToList">← 返回文章列表</el-button>
        <h3>{{ currentText.title }}</h3>
      </div>
      <TypingArena
        :key="`free-${currentText.id}-${arenaKey}`"
        :target="currentText.content"
        mode="article"
        :duration-seconds="null"
        :task-id="null"
      />
    </template>

    <!-- 自由练习：文章选择列表 -->
    <template v-else>
      <h3>自由练习 · 选择一篇文章</h3>
      <el-table :data="freeTexts" data-testid="text-list">
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="语言" width="90">
          <template #default="{ row }">{{ row.language === 'zh' ? '中文' : '英文' }}</template>
        </el-table-column>
        <el-table-column prop="difficulty" label="难度" width="90" />
        <el-table-column prop="charCount" label="字数" width="90" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="startFree(row)">开始练习</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!freeTexts.length" description="暂无可练习的文章" />
    </template>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.page-header h3 {
  margin: 0;
}
.page-header .sub {
  color: #909399;
  font-size: 13px;
}
</style>

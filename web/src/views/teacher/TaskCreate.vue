<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'created'): void }>()

interface ClassItem {
  id: number
  name: string
  studentCount: number
}
interface TextItem {
  id: number
  title: string
  language: string
  charCount: number
}

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const classes = ref<ClassItem[]>([])
const texts = ref<TextItem[]>([])
const loading = ref(false)
const submitting = ref(false)

const form = reactive({
  title: '',
  classId: null as number | null,
  textId: null as number | null,
  mode: 'article' as 'article' | 'time',
  durationSeconds: null as number | null,
  minSpeed: 20,
  minAccuracy: 95,
  deadline: '',
})

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return
    // 打开时重置表单并加载班级 / 自建文章下拉数据
    form.title = ''
    form.classId = null
    form.textId = null
    form.mode = 'article'
    form.durationSeconds = null
    form.minSpeed = 20
    form.minAccuracy = 95
    form.deadline = ''
    loading.value = true
    try {
      const [classData, textData] = await Promise.all([
        request.get<{ list: ClassItem[] }>('/classes'),
        request.get<{ list: TextItem[] }>('/texts', {
          params: { page: 1, pageSize: 100 },
        }),
      ])
      classes.value = classData.list
      texts.value = textData.list
    } finally {
      loading.value = false
    }
  },
)

async function submit() {
  if (!form.title.trim()) {
    ElMessage.warning('请输入任务标题')
    return
  }
  if (form.classId === null) {
    ElMessage.warning('请选择班级')
    return
  }
  if (form.textId === null) {
    ElMessage.warning('请选择文章')
    return
  }
  if (form.mode === 'time' && (!form.durationSeconds || form.durationSeconds < 10)) {
    ElMessage.warning('限时模式需填写不少于 10 秒的时长')
    return
  }
  if (!form.deadline) {
    ElMessage.warning('请选择截止时间')
    return
  }
  submitting.value = true
  try {
    await request.post('/tasks', {
      title: form.title.trim(),
      classId: form.classId,
      textId: form.textId,
      mode: form.mode,
      durationSeconds: form.mode === 'time' ? form.durationSeconds : undefined,
      minSpeed: form.minSpeed,
      minAccuracy: form.minAccuracy,
      deadline: new Date(form.deadline).toISOString(),
    })
    ElMessage.success('任务已发布')
    visible.value = false
    emit('created')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="发布任务" width="560px">
    <div v-loading="loading">
      <el-form label-width="90px">
        <el-form-item label="任务标题">
          <el-input
            v-model="form.title"
            data-testid="task-title"
            placeholder="例如：期末打字测试"
            maxlength="100"
          />
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="form.classId" placeholder="选择班级" style="width: 100%">
            <el-option
              v-for="c in classes"
              :key="c.id"
              :label="`${c.name}（${c.studentCount}人）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="文章">
          <el-select v-model="form.textId" placeholder="选择文章" style="width: 100%">
            <el-option
              v-for="t in texts"
              :key="t.id"
              :label="`${t.title}（${t.language === 'zh' ? '中文' : '英文'} ${t.charCount} 字）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="练习模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="article">整篇</el-radio>
            <el-radio value="time">限时</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.mode === 'time'" label="限时（秒）">
          <el-input-number v-model="form.durationSeconds" :min="10" :max="3600" />
        </el-form-item>
        <el-form-item label="达标速度">
          <el-input-number v-model="form.minSpeed" :min="0" :max="500" />
          <span style="margin-left: 8px; color: #909399">字/分</span>
        </el-form-item>
        <el-form-item label="达标准确率">
          <el-input-number v-model="form.minAccuracy" :min="0" :max="100" />
          <span style="margin-left: 8px; color: #909399">%</span>
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker
            v-model="form.deadline"
            type="datetime"
            placeholder="选择截止时间"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <div style="text-align: right">
        <el-button @click="visible = false">取消</el-button>
        <el-button data-testid="task-submit" type="primary" :loading="submitting" @click="submit">
          发布
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

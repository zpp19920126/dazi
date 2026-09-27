<template>
  <div class="change-password-page">
    <el-card class="card" shadow="always">
      <h2 class="title">修改密码</h2>
      <p class="tip">首次登录或密码被重置后，需先修改密码才能进入系统（新密码至少 6 位）</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent>
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入旧密码"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="请输入新密码（至少 6 位）"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="请再次输入新密码"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="submit-button" :loading="loading" @click="handleSubmit">
            确认修改
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormItemRule, type FormRules } from 'element-plus'
import request from '@/utils/request'
import { useAuthStore, roleHome } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const validateConfirm = (_rule: FormItemRule, value: string, callback: (error?: Error) => void) => {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的新密码不一致'))
  } else {
    callback()
  }
}

const validateNotSameAsOld = (_rule: FormItemRule, value: string, callback: (error?: Error) => void) => {
  if (form.oldPassword && value === form.oldPassword) {
    callback(new Error('新密码不能与旧密码相同'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' },
    { validator: validateNotSameAsOld, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' },
  ],
}

/** 提交改密：成功后清除强制改密标记并跳对应角色首页；失败（如旧密码不正确）由 request 统一提示，停留本页 */
async function handleSubmit() {
  if (loading.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await request.post('/auth/change-password', {
      oldPassword: form.oldPassword,
      newPassword: form.newPassword,
    })
    ElMessage.success('密码修改成功')
    auth.markPasswordChanged()
    if (auth.user) {
      router.push(roleHome[auth.user.role])
    }
  } catch {
    // 改密失败：错误提示已由 request.ts 响应拦截器统一处理
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.change-password-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f3b8f 0%, #3a7bd5 100%);
}

.card {
  width: 420px;
  border-radius: 8px;
}

.title {
  margin: 0;
  text-align: center;
  color: #303133;
}

.tip {
  margin: 12px 0 20px;
  font-size: 13px;
  color: #909399;
  text-align: center;
}
</style>

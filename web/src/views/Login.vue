<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="brand">
        <h1 class="brand-name">打字通</h1>
        <p class="brand-sub">在线打字练习系统</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent>
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            name="username"
            autocomplete="username"
            placeholder="请输入账号"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            name="password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入密码"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="login-button"
          :loading="loading"
          @click="handleLogin"
        >
          登 录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { useAuthStore, roleHome, type UserInfo } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

/** 登录：校验通过 → 调 store → 按角色跳对应首页；失败时 request 拦截器已统一提示，停留本页 */
async function handleLogin() {
  if (loading.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const user: UserInfo = await auth.login({ ...form })
    router.push(roleHome[user.role])
  } catch {
    // 登录失败：错误提示已由 request.ts 响应拦截器统一处理
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f3b8f 0%, #3a7bd5 100%);
}

.login-card {
  width: 380px;
  border-radius: 8px;
}

.brand {
  text-align: center;
  margin-bottom: 24px;
}

.brand-name {
  margin: 0;
  font-size: 32px;
  letter-spacing: 6px;
  color: #303133;
}

.brand-sub {
  margin: 8px 0 0;
  font-size: 14px;
  color: #909399;
}

.login-button {
  width: 100%;
}
</style>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const roleText: Record<string, string> = { student: '学生', teacher: '教师', admin: '管理员' }

/* ---------- 修改密码 ---------- */
const formRef = ref()
const changing = ref(false)
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const rules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, cb: (err?: Error) => void) => {
        if (value !== form.newPassword) cb(new Error('两次输入的新密码不一致'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

async function changePassword() {
  await formRef.value?.validate()
  changing.value = true
  try {
    await request.post('/auth/change-password', {
      oldPassword: form.oldPassword,
      newPassword: form.newPassword,
    })
    ElMessage.success('密码修改成功，请重新登录')
    auth.logout()
    router.push('/login')
  } finally {
    changing.value = false
  }
}

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="profile">
    <el-card shadow="never">
      <template #header>个人信息</template>
      <div class="info-grid">
        <div><label>用户名</label>{{ auth.user?.username }}</div>
        <div><label>姓名</label>{{ auth.user?.realName }}</div>
        <div><label>角色</label>{{ roleText[auth.user?.role ?? ''] ?? auth.user?.role }}</div>
        <div><label>班级 ID</label>{{ auth.user?.classId ?? '-' }}</div>
      </div>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>修改密码</template>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="90px"
        style="max-width: 420px"
        @submit.prevent
      >
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="changing" @click="changePassword">保存</el-button>
          <el-button @click="logout">退出登录</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.profile {
  max-width: 720px;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  font-size: 15px;
}
.info-grid label {
  color: #909399;
  margin-right: 12px;
}
</style>

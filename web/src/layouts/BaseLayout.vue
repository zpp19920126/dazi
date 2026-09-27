<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { MenuItem } from './menus'

const props = defineProps<{ menus: MenuItem[] }>()

const route = useRoute()
const auth = useAuthStore()

// 当前高亮菜单：路由带参数时（如 /student/typing/1）也能匹配到前缀对应项
const activeMenu = computed(
  () => props.menus.find((item) => route.path.startsWith(item.path))?.path ?? route.path,
)
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">在线打字练习系统</div>
      <el-menu
        router
        :default-active="activeMenu"
        class="menu"
        background-color="#1f2d3d"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          {{ item.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-right">
          <span class="username">{{ auth.user?.realName ?? '未登录' }}</span>
          <el-button link type="danger" @click="auth.logout()">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}

.aside {
  display: flex;
  flex-direction: column;
}

.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  background-color: #1f2d3d;
  white-space: nowrap;
}

.menu {
  flex: 1;
  border-right: none;
}

.header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.username {
  color: #303133;
}

.main {
  background-color: #f5f7fa;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => String(route.meta.title ?? '页面'))
</script>

<template>
  <div class="placeholder">
    <h2>{{ title }}</h2>
    <el-empty description="建设中" />
  </div>
</template>

<style scoped>
.placeholder {
  padding: 24px;
  background-color: #fff;
  border-radius: 4px;
}

.placeholder h2 {
  margin: 0 0 16px;
  font-size: 20px;
  color: #303133;
}
</style>

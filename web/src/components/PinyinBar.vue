<script setup lang="ts">
/** 拼音提示条：v1 依赖系统输入法上屏（compositionend），此处仅提示当前拼音串 */
defineProps<{ pinyin: string }>()
</script>

<template>
  <div v-if="pinyin" class="pinyin-bar" data-testid="pinyin-bar">
    <span class="label">拼音</span>
    <span class="raw">{{ pinyin }}</span>
    <span class="hint">（使用输入法选字后自动上屏）</span>
  </div>
</template>

<style scoped>
.pinyin-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 12px;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 4px;
  font-size: 14px;
}
.pinyin-bar .label {
  color: #67c23a;
  font-weight: 600;
}
.pinyin-bar .raw {
  font-family: monospace;
  font-size: 15px;
  color: #303133;
}
.pinyin-bar .hint {
  color: #909399;
  font-size: 12px;
}
</style>

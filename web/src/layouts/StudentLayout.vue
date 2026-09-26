<script setup lang="ts">
import BaseLayout from './BaseLayout.vue'
import { studentMenus } from './menus'
</script>

<template>
  <BaseLayout :menus="studentMenus" />
</template>

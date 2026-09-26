<script setup lang="ts">
import BaseLayout from './BaseLayout.vue'
import { teacherMenus } from './menus'
</script>

<template>
  <BaseLayout :menus="teacherMenus" />
</template>

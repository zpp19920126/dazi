<script setup lang="ts">
import BaseLayout from './BaseLayout.vue'
import { adminMenus } from './menus'
</script>

<template>
  <BaseLayout :menus="adminMenus" />
</template>

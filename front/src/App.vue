<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LoginPage from './components/auth/LoginPage.vue'
import MainApp from './components/MainApp.vue'
import { authApi } from './api/auth'
import { isAuthenticated } from './stores/auth'

const authReady = ref(false)

onMounted(async () => {
  if (isAuthenticated.value) {
    try {
      await authApi.me()
    } catch {
      // token invalid — cleared in request handler
    }
  }
  authReady.value = true
})
</script>

<template>
  <div class="h-full">
    <div
      v-if="!authReady"
      class="flex items-center justify-center h-full text-gray-400 text-sm"
    >
      加载中...
    </div>
    <LoginPage v-else-if="!isAuthenticated" />
    <MainApp v-else />
  </div>
</template>

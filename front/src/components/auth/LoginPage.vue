<script setup lang="ts">
import { ref } from 'vue'
import { authApi } from '@/api/auth'

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    if (mode.value === 'login') {
      await authApi.login(email.value.trim(), password.value)
    } else {
      await authApi.register(email.value.trim(), password.value)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-center min-h-full bg-gray-50 px-4">
    <div class="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <div class="flex items-center gap-3 mb-8">
        <div
          class="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-white text-lg font-bold"
        >
          M
        </div>
        <div>
          <h1 class="text-xl font-semibold text-gray-900">MemBot</h1>
          <p class="text-sm text-gray-500">智能客服助手</p>
        </div>
      </div>

      <div class="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
        <button
          type="button"
          :class="[
            'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
            mode === 'login'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700',
          ]"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          type="button"
          :class="[
            'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
            mode === 'register'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700',
          ]"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">
            邮箱
          </label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">
            密码
          </label>
          <input
            v-model="password"
            type="password"
            required
            :minlength="mode === 'register' ? 6 : 1"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            class="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            placeholder="至少 6 位"
          />
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {{ loading ? '处理中…' : mode === 'login' ? '登录' : '注册' }}
        </button>
      </form>

      <p class="mt-6 text-xs text-gray-400 text-center">
        登录后可使用对话、知识库与长期记忆
      </p>
    </div>
  </div>
</template>

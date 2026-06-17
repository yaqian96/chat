<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import {
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Share2,
  CheckCircle2,
  Search,
} from 'lucide-vue-next'
import type { ChatMessage } from '@/types/chat'

const props = defineProps<{
  message: ChatMessage
  loading?: boolean
}>()

const emit = defineEmits<{
  copy: [content: string]
  regenerate: []
}>()

marked.setOptions({ breaks: true, gfm: true })

const htmlContent = computed(() => {
  if (props.message.role === 'user') return ''
  return marked.parse(props.message.content) as string
})

const hasSummary = computed(() =>
  props.message.content.includes('总结') ||
  props.message.content.includes('### 总结')
)

async function handleCopy() {
  await navigator.clipboard.writeText(props.message.content)
  emit('copy', props.message.content)
}
</script>

<template>
  <div
    :class="[
      'w-full',
      message.role === 'user' ? 'flex justify-end' : '',
    ]"
  >
    <div
      v-if="message.role === 'user'"
      class="max-w-[70%] bg-brand text-white px-4 py-3 rounded-2xl rounded-br-md text-[15px] leading-relaxed"
    >
      {{ message.content }}
    </div>

    <div v-else class="w-full max-w-chat">
      <div
        v-if="loading"
        class="flex items-center gap-3 py-1"
        role="status"
        aria-live="polite"
      >
        <div class="relative flex h-8 w-8 items-center justify-center rounded-full bg-brand-light">
          <Search :size="16" class="text-brand animate-pulse" />
          <span class="absolute inset-0 rounded-full border border-brand/20 animate-ping" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium text-gray-700">AI 正在搜索中</span>
          <span class="flex items-center gap-1">
            <span class="search-dot" />
            <span class="search-dot search-dot-delay-1" />
            <span class="search-dot search-dot-delay-2" />
          </span>
        </div>
      </div>

      <template v-else>
      <div
        v-if="hasSummary"
        class="flex items-center gap-2 mb-3 text-gray-800"
      >
        <CheckCircle2 :size="18" class="text-emerald-500 shrink-0" />
        <span class="font-semibold text-base">总结</span>
      </div>

      <div class="markdown-body" v-html="htmlContent" />

      <!-- 中断标记 -->
      <div
        v-if="message.status === 'incomplete'"
        class="mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 inline-block"
      >
        ⚠️ 回答已停止
      </div>

      <div class="flex items-center gap-1 mt-4">
        <button
          type="button"
          class="action-btn"
          title="复制"
          @click="handleCopy"
        >
          <Copy :size="15" />
        </button>
        <button
          type="button"
          class="action-btn"
          title="重新生成"
          @click="emit('regenerate')"
        >
          <RefreshCw :size="15" />
        </button>
        <button type="button" class="action-btn" title="点赞">
          <ThumbsUp :size="15" />
        </button>
        <button type="button" class="action-btn" title="点踩">
          <ThumbsDown :size="15" />
        </button>
        <button type="button" class="action-btn" title="分享">
          <Share2 :size="15" />
        </button>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.action-btn {
  @apply p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors;
}

.search-dot {
  @apply h-1.5 w-1.5 rounded-full bg-brand/70;
  animation: search-bounce 1.2s ease-in-out infinite;
}

.search-dot-delay-1 {
  animation-delay: 0.15s;
}

.search-dot-delay-2 {
  animation-delay: 0.3s;
}

@keyframes search-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>

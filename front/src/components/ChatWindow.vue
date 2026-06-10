<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { PanelLeftOpen, Zap } from 'lucide-vue-next'
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import type { ChatMessage as ChatMessageType } from '@/types/chat'

const props = defineProps<{
  title: string
  messages: ChatMessageType[]
  disabled?: boolean
  sidebarCollapsed?: boolean
}>()

const emit = defineEmits<{
  send: [message: string]
  toggleSidebar: []
}>()

const fastMode = ref(false)
const scrollRef = ref<HTMLElement | null>(null)

watch(
  () => props.messages.map((m) => m.content).join('\n'),
  async () => {
    await nextTick()
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  },
  { immediate: true }
)

function handleSend(text: string) {
  emit('send', text)
}
</script>

<template>
  <div class="flex flex-col h-full bg-white">
    <header
      class="shrink-0 flex items-center gap-3 h-14 px-4 sm:px-6 border-b border-gray-100"
    >
      <button
        v-if="sidebarCollapsed"
        type="button"
        class="shrink-0 p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="展开侧边栏"
        @click="emit('toggleSidebar')"
      >
        <PanelLeftOpen :size="18" />
      </button>
      <h1 class="flex-1 min-w-0 text-base font-medium text-gray-800 truncate">
        {{ title }}
      </h1>
      <label
        class="flex shrink-0 items-center gap-2 cursor-pointer select-none"
      >
        <span class="text-sm text-gray-500">快速模式</span>
        <button
          type="button"
          role="switch"
          :aria-checked="fastMode"
          :class="[
            'relative w-10 h-5 rounded-full transition-colors',
            fastMode ? 'bg-brand' : 'bg-gray-200',
          ]"
          @click="fastMode = !fastMode"
        >
          <span
            :class="[
              'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
              fastMode ? 'translate-x-5' : 'translate-x-0',
            ]"
          />
        </button>
        <Zap
          :size="16"
          :class="fastMode ? 'text-brand' : 'text-gray-300'"
        />
      </label>
    </header>

    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto"
    >
      <div class="max-w-chat mx-auto px-6 py-8 space-y-8">
        <ChatMessage
          v-for="(msg, index) in messages"
          :key="msg.id"
          :message="msg"
          :loading="
            disabled &&
            msg.role === 'assistant' &&
            !msg.content &&
            index === messages.length - 1
          "
        />
      </div>
    </div>

    <div class="shrink-0 border-t border-gray-100 bg-white">
      <ChatInput :disabled="disabled" @send="handleSend" />
    </div>
  </div>
</template>

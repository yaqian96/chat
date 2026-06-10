<script setup lang="ts">
import { ref } from 'vue'
import { Paperclip, ArrowUp, Brain, Globe } from 'lucide-vue-next'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [message: string]
}>()

const input = ref('')
const deepThinking = ref(false)
const smartSearch = ref(true)

function handleSend() {
  if (props.disabled) return
  const text = input.value.trim()
  if (!text) return
  emit('send', text)
  input.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="w-full max-w-chat mx-auto px-4 pb-6">
    <div
      class="relative bg-white border border-gray-200 rounded-2xl shadow-sm hover:border-gray-300 focus-within:border-brand/40 focus-within:shadow-md transition-all"
    >
      <textarea
        v-model="input"
        rows="3"
        placeholder="给 MemBot 发送消息"
        :disabled="disabled"
        class="w-full resize-none bg-transparent px-4 pt-4 pb-14 text-[15px] text-gray-800 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
        @keydown="handleKeydown"
      />

      <div class="absolute bottom-3 left-3 right-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button
            type="button"
            :class="[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              deepThinking
                ? 'bg-brand-light border-brand/30 text-brand'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100',
            ]"
            @click="deepThinking = !deepThinking"
          >
            <Brain :size="14" />
            深度思考
          </button>
          <button
            type="button"
            :class="[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              smartSearch
                ? 'bg-brand-light border-brand/30 text-brand'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100',
            ]"
            @click="smartSearch = !smartSearch"
          >
            <Globe :size="14" />
            智能搜索
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="上传附件"
          >
            <Paperclip :size="18" />
          </button>
          <button
            type="button"
            :disabled="disabled || !input.trim()"
            :class="[
              'p-2 rounded-full transition-all',
              input.trim()
                ? 'bg-brand text-white hover:bg-brand-hover shadow-sm'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed',
            ]"
            aria-label="发送"
            @click="handleSend"
          >
            <ArrowUp :size="18" />
          </button>
        </div>
      </div>
    </div>

    <p class="text-center text-xs text-gray-400 mt-3">
      MemBot 可能会犯错，请核实重要信息
    </p>
  </div>
</template>

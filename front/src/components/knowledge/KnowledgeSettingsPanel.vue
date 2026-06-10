<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, Upload, PanelLeftOpen, ArrowLeft } from 'lucide-vue-next'
import type { KnowledgeTab } from '@/types/knowledge'
import YoudaoNotesTab from './YoudaoNotesTab.vue'
import LocalUploadTab from './LocalUploadTab.vue'

defineProps<{
  sidebarCollapsed?: boolean
}>()

const emit = defineEmits<{
  back: []
  toggleSidebar: []
}>()

const activeTab = ref<KnowledgeTab>('youdao')

const tabs: { id: KnowledgeTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'youdao', label: '有道云笔记', icon: BookOpen },
  { id: 'local', label: '本地批量上传', icon: Upload },
]
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
      <button
        type="button"
        class="shrink-0 p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="返回对话"
        @click="emit('back')"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="flex-1 min-w-0">
        <h1 class="text-base font-medium text-gray-800 truncate">
          外部知识库
        </h1>
        <p class="text-xs text-gray-400 truncate">
          配置知识来源，增强 MemBot 回答能力
        </p>
      </div>
    </header>

    <div class="shrink-0 flex gap-1 px-4 sm:px-6 border-b border-gray-100 bg-gray-50/50">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="[
          'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
          activeTab === tab.id
            ? 'text-brand border-brand bg-white'
            : 'text-gray-500 border-transparent hover:text-gray-700',
        ]"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" :size="16" />
        {{ tab.label }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <YoudaoNotesTab v-if="activeTab === 'youdao'" />
        <LocalUploadTab v-else />
      </div>
    </div>
  </div>
</template>

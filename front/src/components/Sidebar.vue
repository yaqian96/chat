<script setup lang="ts">
import {
  LogOut,
  PanelLeftClose,
  Plus,
  Search,
  Trash2,
} from 'lucide-vue-next'
import type { HistoryGroup } from '@/types/chat'

defineProps<{
  collapsed: boolean
  historyGroups: HistoryGroup[]
  activeSessionId: string
  knowledgeActive?: boolean
  loading?: boolean
  userEmail?: string
}>()

const emit = defineEmits<{
  toggle: []
  newChat: []
  selectSession: [id: string]
  deleteSession: [id: string]
  openKnowledge: []
  logout: []
}>()
</script>

<template>
  <aside
    :class="[
      'flex flex-col h-full bg-sidebar border-r border-gray-200 transition-all duration-300 shrink-0',
      collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[280px]',
    ]"
  >
    <div class="flex items-center justify-between px-4 h-14 shrink-0">
      <div class="flex items-center gap-2">
        <div
          class="w-7 h-7 rounded-lg bg-brand flex items-center justify-center text-white text-sm font-bold"
        >
          M
        </div>
        <span class="text-base font-semibold text-gray-800">MemBot</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 hover:text-gray-700 transition-colors"
          aria-label="搜索"
        >
          <Search :size="18" />
        </button>
        <button
          type="button"
          class="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 hover:text-gray-700 transition-colors"
          aria-label="收起侧边栏"
          @click="emit('toggle')"
        >
          <PanelLeftClose :size="18" />
        </button>
      </div>
    </div>

    <div class="px-3 mb-2">
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
        @click="emit('newChat')"
      >
        <Plus :size="16" />
        开启新对话
      </button>
    </div>

    <nav class="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
      <p
        v-if="loading"
        class="px-3 py-4 text-sm text-gray-400 text-center"
      >
        加载历史中...
      </p>
      <p
        v-else-if="historyGroups.length === 0"
        class="px-3 py-4 text-sm text-gray-400 text-center"
      >
        暂无对话记录
      </p>
      <div v-for="group in historyGroups" :key="group.label" class="mb-4">
        <p class="px-3 py-1.5 text-xs text-gray-400 font-medium">
          {{ group.label }}
        </p>
        <ul class="space-y-0.5">
          <li v-for="session in group.sessions" :key="session.id">
            <button
              type="button"
              :class="[
                'group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-all relative',
                activeSessionId === session.id
                  ? 'bg-brand-light text-brand font-medium'
                  : 'text-gray-600 hover:bg-gray-200/60',
              ]"
              @click="emit('selectSession', session.id)"
            >
              <span
                v-if="activeSessionId === session.id"
                class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-brand rounded-r"
              />
              <span class="flex-1 truncate pl-1">{{ session.title }}</span>
              <button
                type="button"
                :class="[
                  'opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity shrink-0',
                  activeSessionId === session.id
                    ? 'text-brand/60 hover:text-red-500 hover:bg-red-50'
                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50',
                ]"
                aria-label="删除对话"
                @click.stop="emit('deleteSession', session.id)"
              >
                <Trash2 :size="14" />
              </button>
            </button>
          </li>
        </ul>
      </div>
    </nav>

    <div class="shrink-0 p-3 border-t border-gray-200 space-y-1">
      <button
        type="button"
        :class="[
          'w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-left',
          knowledgeActive
            ? 'bg-brand-light text-brand'
            : 'hover:bg-gray-200/50',
        ]"
        @click="emit('openKnowledge')"
      >
        <div
          class="w-8 h-8 rounded-full bg-gradient-to-br from-brand to-blue-400 flex items-center justify-center text-white text-xs font-medium"
        >
          {{ (userEmail ?? 'U').charAt(0).toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800 truncate">
            {{ userEmail ?? '未登录' }}
          </p>
          <p class="text-xs text-gray-400 truncate">外部知识库配置</p>
        </div>
      </button>
      <button
        type="button"
        class="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-200/50 hover:text-gray-700 transition-colors"
        @click="emit('logout')"
      >
        <LogOut :size="16" />
        退出登录
      </button>
    </div>
  </aside>
</template>

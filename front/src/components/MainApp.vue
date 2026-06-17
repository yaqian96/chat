<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Sidebar from './Sidebar.vue'
import ChatWindow from './ChatWindow.vue'
import KnowledgeSettingsPanel from './knowledge/KnowledgeSettingsPanel.vue'
import { api } from '@/api/client'
import { streamChat } from '@/api/stream-chat'
import { clearAuth, currentUser } from '@/stores/auth'
import type { ChatSession, HistoryGroup } from '@/types/chat'

const sidebarCollapsed = ref(false)
const historyGroups = ref<HistoryGroup[]>([])
const historyLoading = ref(true)
const activeSessionId = ref('')
const activeSession = ref<ChatSession | null>(null)
const sending = ref(false)
const connectionError = ref('')
const isStreaming = ref(false)
const hasInterruptedMessage = ref(false)
const interruptedMessageContent = ref('')
const interruptedMessageIndex = ref(-1)

type MainView = 'chat' | 'knowledge'
const mainView = ref<MainView>('chat')

let abortController: AbortController | null = null

async function checkConnection() {
  const { checkHealth } = await import('@/api/client')
  const ok = await checkHealth()
  if (!ok) {
    connectionError.value =
      '无法连接后端 (http://127.0.0.1:3001/api)，请确认 end/ 服务已启动'
    return false
  }
  connectionError.value = ''
  return true
}

async function loadHistory() {
  historyLoading.value = true
  try {
    if (!(await checkConnection())) {
      historyGroups.value = []
      return
    }
    historyGroups.value = await api.getHistory()
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('加载对话历史失败', err)
    connectionError.value = '加载对话历史失败，请检查后端服务'
    historyGroups.value = []
  } finally {
    historyLoading.value = false
  }
}

async function retryConnection() {
  connectionError.value = ''
  await loadHistory()
  if (!connectionError.value) {
    const first = historyGroups.value.flatMap((g) => g.sessions).at(0)
    if (first) {
      await loadSession(first.id)
    } else {
      await handleNewChat()
    }
  }
}

async function loadSession(id: string) {
  try {
    activeSession.value = await api.getSession(id)
    activeSessionId.value = id
    // 重置中断状态
    hasInterruptedMessage.value = false
    interruptedMessageContent.value = ''
    interruptedMessageIndex.value = -1
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('加载会话失败', err)
  }
}

async function handleSelectSession(id: string) {
  mainView.value = 'chat'
  if (id === activeSessionId.value && activeSession.value) return
  await loadSession(id)
}

async function handleNewChat() {
  mainView.value = 'chat'
  try {
    const session = await api.createSession()
    activeSession.value = session
    activeSessionId.value = session.id
    await loadHistory()
    // 重置中断状态
    hasInterruptedMessage.value = false
    interruptedMessageContent.value = ''
    interruptedMessageIndex.value = -1
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('创建会话失败', err)
  }
}

async function handleDeleteSession(id: string) {
  const title =
    historyGroups.value
      .flatMap((g) => g.sessions)
      .find((s) => s.id === id)?.title ?? '此对话'

  if (!confirm(`确定删除「${title}」吗？此操作不可恢复。`)) return

  try {
    await api.deleteSession(id)
    await loadHistory()

    if (activeSessionId.value === id) {
      const next = historyGroups.value.flatMap((g) => g.sessions).at(0)
      if (next) {
        await loadSession(next.id)
      } else {
        await handleNewChat()
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('删除会话失败', err)
    connectionError.value = '删除会话失败，请稍后重试'
  }
}

function handleStop() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  isStreaming.value = false
  sending.value = false

  // 标记最后一条 AI 消息为不完整
  if (activeSession.value && interruptedMessageIndex.value >= 0) {
    const msg = activeSession.value.messages[interruptedMessageIndex.value]
    if (msg) {
      msg.status = 'incomplete'
      hasInterruptedMessage.value = true
      interruptedMessageContent.value = msg.content
    }
  }
}

async function handleContinue() {
  if (!activeSession.value || sending.value) return

  // 清除中断标记
  hasInterruptedMessage.value = false
  interruptedMessageContent.value = ''

  // 将不完整消息更新为完整（续传后会追加）
  if (interruptedMessageIndex.value >= 0) {
    const msg = activeSession.value.messages[interruptedMessageIndex.value]
    if (msg) {
      msg.status = 'streaming'
    }
  }

  // 发送续传请求
  const continuePrompt = '请继续上面的内容'
  sending.value = true
  isStreaming.value = true

  // 创建新的 AbortController（续传也需要可被中断）
  abortController = new AbortController()

  try {
    const result = await streamChat(activeSessionId.value, continuePrompt, {
      onEvent: (event) => {
        if (event.type === 'token' && event.content) {
          const msg = activeSession.value?.messages[interruptedMessageIndex.value]
          if (msg) msg.content += event.content
        }
      },
      signal: abortController.signal,
    })

    if (result.ok) {
      await loadHistory()
      await loadSession(activeSessionId.value)
    } else {
      const errText = result.error ?? '对话生成失败'
      connectionError.value = errText
    }
  } catch (err) {
    // 如果是主动中断，不显示错误
    if (err instanceof DOMException && err.name === 'AbortError') {
      return
    }
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('续传失败', err)
    connectionError.value = err instanceof Error ? err.message : '续传失败'
  } finally {
    sending.value = false
    isStreaming.value = false
    abortController = null
  }
}

async function handleSend(text: string) {
  if (!activeSession.value || sending.value) return
  sending.value = true
  isStreaming.value = true

  // 如果有中断的不完整消息，先标记为完整
  if (hasInterruptedMessage.value && interruptedMessageIndex.value >= 0) {
    const msg = activeSession.value.messages[interruptedMessageIndex.value]
    if (msg) {
      msg.status = 'complete'
    }
    hasInterruptedMessage.value = false
    interruptedMessageContent.value = ''
  }

  try {
    if (!activeSessionId.value) {
      const session = await api.createSession()
      activeSession.value = session
      activeSessionId.value = session.id
    }

    const userMsg = {
      id: `local-${Date.now()}`,
      role: 'user' as const,
      content: text,
      createdAt: new Date(),
    }
    activeSession.value.messages.push(userMsg)

    if (activeSession.value.title === '新对话') {
      activeSession.value.title =
        text.slice(0, 30) + (text.length > 30 ? '...' : '')
    }

    activeSession.value.messages.push({
      id: `local-${Date.now()}-ai`,
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      status: 'streaming',
    })
    const assistantIdx = activeSession.value.messages.length - 1
    interruptedMessageIndex.value = assistantIdx

    // 创建新的 AbortController
    abortController = new AbortController()

    const result = await streamChat(activeSessionId.value, text, {
      onEvent: (event) => {
        if (event.type === 'token' && event.content) {
          const msg = activeSession.value?.messages[assistantIdx]
          if (msg) msg.content += event.content
        }
      },
      signal: abortController.signal,
    })

    if (result.ok) {
      await loadHistory()
      await loadSession(activeSessionId.value)
    } else if (result.interrupted) {
      // 中断不视为错误
      return
    } else {
      const errText = result.error ?? '对话生成失败'
      connectionError.value = errText
      const msg = activeSession.value?.messages[assistantIdx]
      if (msg && !msg.content) msg.content = errText
    }
  } catch (err) {
    // 如果是主动中断，不显示错误
    if (err instanceof DOMException && err.name === 'AbortError') {
      return
    }
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return
    console.error('发送消息失败', err)
    connectionError.value =
      err instanceof Error ? err.message : '发送消息失败'
  } finally {
    sending.value = false
    isStreaming.value = false
    abortController = null
  }
}

function handleLogout() {
  clearAuth()
}

onMounted(async () => {
  await loadHistory()

  const firstSession = historyGroups.value.flatMap((g) => g.sessions).at(0)

  if (firstSession) {
    await loadSession(firstSession.id)
  } else {
    await handleNewChat()
  }
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="connectionError"
      class="shrink-0 flex items-center justify-between gap-4 px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700"
    >
      <span>{{ connectionError }}</span>
      <button
        type="button"
        class="shrink-0 px-3 py-1 rounded-lg bg-red-100 hover:bg-red-200 transition-colors"
        @click="retryConnection"
      >
        重试
      </button>
    </div>
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar
        :collapsed="sidebarCollapsed"
        :history-groups="historyGroups"
        :active-session-id="activeSessionId"
        :knowledge-active="mainView === 'knowledge'"
        :loading="historyLoading"
        :user-email="currentUser?.email"
        @toggle="sidebarCollapsed = !sidebarCollapsed"
        @new-chat="handleNewChat"
        @select-session="handleSelectSession"
        @delete-session="handleDeleteSession"
        @open-knowledge="mainView = 'knowledge'"
        @logout="handleLogout"
      />
      <main class="flex-1 min-w-0 h-full">
        <KnowledgeSettingsPanel
          v-if="mainView === 'knowledge'"
          :sidebar-collapsed="sidebarCollapsed"
          @back="mainView = 'chat'"
          @toggle-sidebar="sidebarCollapsed = false"
        />
        <ChatWindow
          v-else-if="activeSession"
          :title="activeSession.title"
          :messages="activeSession.messages"
          :disabled="sending"
          :sidebar-collapsed="sidebarCollapsed"
          :is-streaming="isStreaming"
          :has-interrupted-message="hasInterruptedMessage"
          @send="handleSend"
          @stop="handleStop"
          @continue="handleContinue"
          @toggle-sidebar="sidebarCollapsed = false"
        />
        <div
          v-else
          class="flex items-center justify-center h-full text-gray-400 text-sm"
        >
          加载中...
        </div>
      </main>
    </div>
  </div>
</template>

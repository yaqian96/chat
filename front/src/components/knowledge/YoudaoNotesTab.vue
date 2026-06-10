<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  BookOpen,
  ExternalLink,
  Link2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from 'lucide-vue-next'
import { knowledgeApi } from '@/api/knowledge'
import type { YoudaoNotesConfig } from '@/types/knowledge'

const form = ref<YoudaoNotesConfig>({
  apiKey: '',
  folderId: '',
})

const apiKeyConfigured = ref(false)
const apiKeyMasked = ref('')
const saving = ref(false)
const testing = ref(false)
const syncing = ref(false)
const testResult = ref<'idle' | 'success' | 'error'>('idle')
const testMessage = ref('')
const lastSyncedAt = ref<string | null>(null)
const noteCount = ref(0)
const syncError = ref('')
const statusMessage = ref('')

const MCP_CONSOLE_URL = 'https://mopen.163.com'

onMounted(async () => {
  await loadConfig()
})

async function loadConfig() {
  try {
    const config = await knowledgeApi.getYoudaoConfig()
    apiKeyConfigured.value = config.apiKeyConfigured
    apiKeyMasked.value = config.apiKeyMasked
    form.value.folderId = config.folderId

    const status = await knowledgeApi.getYoudaoStatus()
    lastSyncedAt.value = status.lastSyncedAt
    noteCount.value = status.noteCount
    syncError.value = status.lastError ?? ''
  } catch (err) {
    statusMessage.value =
      err instanceof Error ? err.message : '加载配置失败'
  }
}

async function handleSave() {
  if (!form.value.apiKey.trim() && !apiKeyConfigured.value) {
    statusMessage.value = '请填写 API Key'
    return
  }

  saving.value = true
  statusMessage.value = ''
  try {
    const saved = await knowledgeApi.saveYoudaoConfig({
      apiKey: form.value.apiKey.trim(),
      folderId: form.value.folderId.trim(),
    })
    apiKeyConfigured.value = saved.apiKeyConfigured
    apiKeyMasked.value = saved.apiKeyMasked
    form.value.apiKey = ''
    statusMessage.value = '配置已保存'
  } catch (err) {
    statusMessage.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function handleTestConnection() {
  if (!apiKeyConfigured.value && !form.value.apiKey.trim()) {
    testResult.value = 'error'
    testMessage.value = '请先填写并保存 API Key'
    return
  }

  if (form.value.apiKey.trim()) {
    await handleSave()
  }

  testing.value = true
  testResult.value = 'idle'
  testMessage.value = ''
  try {
    const result = await knowledgeApi.testYoudaoConnection()
    testResult.value = result.ok ? 'success' : 'error'
    testMessage.value = result.message
  } catch (err) {
    testResult.value = 'error'
    testMessage.value = err instanceof Error ? err.message : '连接测试失败'
  } finally {
    testing.value = false
  }
}

async function handleSyncNow() {
  if (!apiKeyConfigured.value && !form.value.apiKey.trim()) {
    syncError.value = '请先填写并保存 API Key'
    return
  }

  if (form.value.apiKey.trim()) {
    await handleSave()
  }

  syncing.value = true
  syncError.value = ''
  try {
    const result = await knowledgeApi.syncYoudaoNotes()
    lastSyncedAt.value = result.lastSyncedAt
    noteCount.value = result.notes.length
    statusMessage.value = `同步完成：新增/更新 ${result.synced} 篇，跳过 ${result.skipped} 篇`
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : '同步失败'
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start gap-3 p-4 rounded-xl bg-brand-light/60 border border-brand/10">
      <BookOpen :size="20" class="text-brand shrink-0 mt-0.5" />
      <div>
        <p class="text-sm font-medium text-gray-800">有道云笔记接入</p>
        <p class="text-xs text-gray-500 mt-1 leading-relaxed">
          通过网易智能开发者平台的 API Key，将笔记同步至外部知识库，供 MemBot 检索引用。
        </p>
      </div>
    </div>

    <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p class="font-medium">API Key 从哪里获取？</p>
      <ol class="mt-2 space-y-1.5 text-xs leading-relaxed list-decimal list-inside text-amber-800/90">
        <li>有道云笔记账号需先绑定手机号（客户端 → 账号设置）</li>
        <li>
          打开
          <a
            :href="MCP_CONSOLE_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-0.5 text-brand hover:underline"
          >
            网易智能开发者平台 (mopen.163.com)
            <ExternalLink :size="12" />
          </a>
        </li>
        <li>进入「API 管理」→「创建」，复制生成的 API Key</li>
        <li>只需一个 API Key，不再需要旧版 App Key / App Secret</li>
      </ol>
      <p class="mt-2 text-xs text-amber-700/80">
        旧版 Open API（Consumer Key / Consumer Secret）已停止新增申请，详见
        <a
          href="https://note.youdao.com/open/apidoc.html"
          target="_blank"
          rel="noopener noreferrer"
          class="underline"
        >官方文档</a>。
      </p>
    </div>

    <form class="space-y-4" @submit.prevent="handleSave">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1.5">
          API Key
        </label>
        <input
          v-model="form.apiKey"
          type="password"
          :placeholder="
            apiKeyConfigured
              ? `已配置 ${apiKeyMasked}，留空则不修改`
              : '从 mopen.163.com 创建的 API Key'
          "
          class="input-field"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1.5">
          目录 ID（可选）
        </label>
        <input
          v-model="form.folderId"
          type="text"
          placeholder="留空则同步全部授权笔记目录"
          class="input-field"
        />
        <p class="mt-1 text-xs text-gray-400">
          可通过 youdaonote list 或 MCP 工具查看目录 fileId
        </p>
      </div>

      <div
        v-if="lastSyncedAt"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500"
      >
        <span class="inline-flex items-center gap-1">
          <RefreshCw :size="14" />
          上次同步：{{ new Date(lastSyncedAt).toLocaleString('zh-CN') }}
        </span>
        <span>已入库 {{ noteCount }} 篇笔记</span>
      </div>

      <div
        v-if="testResult === 'success'"
        class="flex items-center gap-2 text-sm text-emerald-600"
      >
        <ShieldCheck :size="16" />
        {{ testMessage }}
      </div>
      <div
        v-else-if="testResult === 'error'"
        class="flex items-center gap-2 text-sm text-red-500"
      >
        <AlertCircle :size="16" />
        {{ testMessage }}
      </div>

      <p v-if="syncError" class="text-sm text-red-500">{{ syncError }}</p>
      <p v-if="statusMessage" class="text-sm text-gray-600">{{ statusMessage }}</p>

      <div class="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          class="btn-secondary"
          :disabled="testing || syncing"
          @click="handleTestConnection"
        >
          <Link2 :size="16" />
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="testing || syncing"
          @click="handleSyncNow"
        >
          <RefreshCw :size="16" :class="syncing ? 'animate-spin' : ''" />
          {{ syncing ? '同步中...' : '立即同步' }}
        </button>
        <button type="submit" class="btn-primary ml-auto" :disabled="saving || syncing">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.input-field {
  @apply w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white
    placeholder:text-gray-400 focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10 transition-all;
}

.btn-primary {
  @apply inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-brand rounded-xl
    hover:bg-brand-hover transition-colors disabled:opacity-50;
}

.btn-secondary {
  @apply inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl
    hover:bg-gray-50 transition-colors disabled:opacity-50;
}
</style>

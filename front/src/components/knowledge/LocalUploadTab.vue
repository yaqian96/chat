<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-vue-next'
import { knowledgeApi } from '@/api/knowledge'
import {
  SUPPORTED_FILE_ACCEPT,
  SUPPORTED_FILE_TYPES,
  type LocalKnowledgeFile,
} from '@/types/knowledge'

const files = ref<LocalKnowledgeFile[]>([])
const dragging = ref(false)
const uploading = ref(false)
const rejectHint = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const pendingCount = computed(
  () => files.value.filter((f) => f.status === 'pending').length,
)
const doneCount = computed(
  () => files.value.filter((f) => f.status === 'done').length,
)

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isSupported(file: File) {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  return SUPPORTED_FILE_TYPES.includes(ext as (typeof SUPPORTED_FILE_TYPES)[number])
}

function addFiles(fileList: FileList | File[]) {
  const list = Array.from(fileList)
  const rejected: string[] = []
  for (const file of list) {
    if (!isSupported(file)) {
      rejected.push(file.name)
      continue
    }
    const exists = files.value.some(
      (f) => f.name === file.name && f.size === file.size,
    )
    if (exists) continue

    files.value.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      file,
      status: 'pending',
    })
  }
  if (rejected.length) {
    rejectHint.value = `已忽略不支持的文件：${rejected.join('、')}（仅支持 PDF、TXT、MD、DOCX、XLSX）`
  } else {
    rejectHint.value = ''
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
}

function removeFile(id: string) {
  files.value = files.value.filter((f) => f.id !== id)
}

function clearDone() {
  files.value = files.value.filter((f) => f.status !== 'done')
}

async function handleUpload() {
  const pending = files.value.filter((f) => f.status === 'pending' && f.file)
  if (!pending.length || uploading.value) return

  uploading.value = true
  for (const item of pending) {
    item.status = 'uploading'
    item.error = undefined
  }

  try {
    const result = await knowledgeApi.uploadFiles(
      pending.map((f) => f.file!),
    )

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      const uploaded = result.files[i]
      if (uploaded) {
        item.status = 'done'
        item.docId = uploaded.docId
      } else {
        item.status = 'error'
        item.error = '上传响应缺失'
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败'
    for (const item of pending) {
      item.status = 'error'
      item.error = message
    }
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100">
      <Upload :size="20" class="text-gray-600 shrink-0 mt-0.5" />
      <div>
        <p class="text-sm font-medium text-gray-800">本地文件批量上传</p>
        <p class="text-xs text-gray-500 mt-1 leading-relaxed">
          支持 PDF、TXT、MD、DOCX、XLSX，上传后将自动解析、分块、向量化并写入知识库。
        </p>
      </div>
    </div>

    <div
      :class="[
        'relative flex flex-col items-center justify-center gap-3 px-6 py-10 border-2 border-dashed rounded-2xl transition-colors cursor-pointer',
        dragging
          ? 'border-brand bg-brand-light/40'
          : 'border-gray-200 bg-white hover:border-brand/30 hover:bg-gray-50/50',
      ]"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
      @click="fileInputRef?.click()"
    >
      <input
        ref="fileInputRef"
        type="file"
        multiple
        :accept="SUPPORTED_FILE_ACCEPT"
        class="hidden"
        @change="onFileChange"
      />
      <div
        class="w-12 h-12 rounded-full bg-brand-light flex items-center justify-center"
      >
        <Upload :size="22" class="text-brand" />
      </div>
      <div class="text-center">
        <p class="text-sm font-medium text-gray-700">
          拖拽文件到此处，或点击选择文件
        </p>
        <p class="text-xs text-gray-400 mt-1">
          支持 PDF、TXT、MD、DOCX、XLSX，单文件建议不超过 20MB
        </p>
      </div>
    </div>

    <div v-if="files.length" class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-600">
          已选 {{ files.length }} 个文件
          <span v-if="doneCount" class="text-emerald-600">
            · 已提交 {{ doneCount }}
          </span>
        </p>
        <button
          v-if="doneCount"
          type="button"
          class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          @click="clearDone"
        >
          清除已完成
        </button>
      </div>

      <ul class="max-h-56 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
        <li
          v-for="file in files"
          :key="file.id"
          class="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-100 rounded-xl"
        >
          <FileText :size="18" class="text-gray-400 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm text-gray-800 truncate">{{ file.name }}</p>
            <p class="text-xs text-gray-400">
              {{ formatSize(file.size) }}
              <span v-if="file.error" class="text-red-500 ml-1">{{ file.error }}</span>
            </p>
          </div>
          <Loader2
            v-if="file.status === 'uploading'"
            :size="16"
            class="text-brand animate-spin shrink-0"
          />
          <CheckCircle2
            v-else-if="file.status === 'done'"
            :size="16"
            class="text-emerald-500 shrink-0"
          />
          <AlertCircle
            v-else-if="file.status === 'error'"
            :size="16"
            class="text-red-500 shrink-0"
          />
          <button
            v-if="file.status !== 'uploading'"
            type="button"
            class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            aria-label="移除"
            @click="removeFile(file.id)"
          >
            <Trash2 :size="14" />
          </button>
        </li>
      </ul>

      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-brand rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50"
        :disabled="!pendingCount || uploading"
        @click="handleUpload"
      >
        <Loader2 v-if="uploading" :size="16" class="animate-spin" />
        <Upload v-else :size="16" />
        {{
          uploading
            ? '上传解析中...'
            : `开始上传（${pendingCount} 个待处理）`
        }}
      </button>
      <p v-if="rejectHint" class="text-xs text-center text-amber-600">
        {{ rejectHint }}
      </p>
      <p class="text-xs text-center text-gray-400">
        上传后将在后台完成分块与向量化，可通过 ingest 状态接口查看进度
      </p>
    </div>
  </div>
</template>

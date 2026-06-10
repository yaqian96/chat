import { Logger } from '@nestjs/common'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const MCP_URL = 'https://open.mail.163.com/api/ynote/mcp/sse'

const LIST_TOOL = 'listNotes'
const READ_TOOL = 'getNoteTextContent'
const SEARCH_TOOL = 'searchNotes'
const RECENT_TOOL = 'getRecentFavoriteNotes'

export interface YoudaoListItem {
  id: string
  title: string
  type: 'file' | 'folder'
  raw: Record<string, unknown>
}

export class YoudaoMcpClient {
  private readonly logger = new Logger(YoudaoMcpClient.name)

  async testConnection(apiKey: string): Promise<{
    ok: boolean
    tools: string[]
    listTool?: string
    readTool?: string
  }> {
    return this.withClient(apiKey, async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      const ok = names.includes(LIST_TOOL) && names.includes(READ_TOOL)
      return {
        ok,
        tools: names,
        listTool: LIST_TOOL,
        readTool: READ_TOOL,
      }
    })
  }

  async fetchNotes(
    apiKey: string,
    folderId?: string,
  ): Promise<Array<{ id: string; title: string; content: string; folderId?: string }>> {
    const toolNames = await this.withClient(apiKey, async (client) => {
      const { tools } = await client.listTools()
      return tools.map((t) => t.name)
    })

    if (!toolNames.includes(LIST_TOOL) || !toolNames.includes(READ_TOOL)) {
      throw new Error(
        `MCP 缺少笔记工具 listNotes/getNoteTextContent，已发现: ${toolNames.join(', ')}`,
      )
    }

    this.logger.log(`Youdao MCP 同步: ${LIST_TOOL} + ${READ_TOOL}`)

    const catalog: Array<{ id: string; title: string; folderId?: string }> = []
    const visitedDirs = new Set<string>()
    const rootId = folderId?.trim() || '0'

    const collectFiles = async (parentId: string) => {
      if (visitedDirs.has(parentId)) return
      visitedDirs.add(parentId)

      let lastId: string | undefined
      do {
        let items: YoudaoListItem[]
        try {
          items = await this.callListTool(apiKey, parentId, lastId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.warn(`列出目录 ${parentId} 失败: ${msg}`)
          break
        }
        if (!items.length) break

        for (const item of items) {
          if (item.type === 'folder') {
            await collectFiles(item.id)
            continue
          }
          catalog.push({
            id: item.id,
            title: item.title,
            folderId: parentId === '0' ? undefined : parentId,
          })
        }

        lastId = items.at(-1)?.id
        if (items.length < 20) break
      } while (lastId)
    }

    await collectFiles(rootId)

    if (!catalog.length) {
      this.logger.warn('目录遍历无笔记，尝试 searchNotes / getRecentFavoriteNotes 补充')
      const extra = await this.fetchViaSearchAndRecent(apiKey, toolNames)
      catalog.push(...extra)
    }

    const notes: Array<{
      id: string
      title: string
      content: string
      folderId?: string
    }> = []
    const seen = new Set<string>()

    for (const [index, item] of catalog.entries()) {
      if (seen.has(item.id)) continue
      seen.add(item.id)

      try {
        const content = await this.callReadTool(apiKey, item.id)
        if (!content.trim()) continue

        notes.push({
          id: item.id,
          title: item.title,
          content,
          folderId: item.folderId,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`跳过笔记 ${item.title} (${item.id}): ${msg}`)
      }

      if ((index + 1) % 10 === 0) {
        this.logger.log(`已读取 ${index + 1}/${catalog.length} 篇`)
      }
    }

    this.logger.log(`Youdao MCP 同步完成: 发现 ${catalog.length} 篇，写入 ${notes.length} 篇`)
    return notes
  }

  private async fetchViaSearchAndRecent(
    apiKey: string,
    toolNames: string[],
  ): Promise<Array<{ id: string; title: string; folderId?: string }>> {
    const catalog: Array<{ id: string; title: string; folderId?: string }> = []
    const seen = new Set<string>()

    if (toolNames.includes(RECENT_TOOL)) {
      const text = await this.callTool(apiKey, RECENT_TOOL, {})
      for (const item of this.parseListItems(text)) {
        if (item.type === 'folder' || seen.has(item.id)) continue
        seen.add(item.id)
        catalog.push({ id: item.id, title: item.title })
      }
    }

    if (toolNames.includes(SEARCH_TOOL)) {
      const keywords = ['笔记', '的', 'a']
      for (const keyword of keywords) {
        let startIndex = 0
        for (let page = 0; page < 20; page++) {
          const text = await this.callTool(apiKey, SEARCH_TOOL, {
            keyword,
            startIndex,
          })
          const items = this.parseListItems(text)
          if (!items.length) break

          for (const item of items) {
            if (item.type === 'folder' || seen.has(item.id)) continue
            seen.add(item.id)
            catalog.push({ id: item.id, title: item.title })
          }

          if (items.length < 15) break
          startIndex += 15
        }
      }
    }

    return catalog
  }

  private async withClient<T>(
    apiKey: string,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect(apiKey)
    try {
      return await fn(client)
    } finally {
      await client.close().catch(() => {})
    }
  }

  private async callTool(
    apiKey: string,
    name: string,
    args: Record<string, unknown>,
    retries = 2,
  ): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.withClient(apiKey, async (client) => {
          const result = await client.callTool({ name, arguments: args })
          return this.extractText(result)
        })
      } catch (err) {
        lastError = err
        const msg = err instanceof Error ? err.message : String(err)
        if (attempt < retries && /session not found|404|timeout/i.test(msg)) {
          this.logger.warn(`MCP ${name} 失败，重试 ${attempt + 1}/${retries}`)
          await this.sleep(400 * (attempt + 1))
          continue
        }
        throw err
      }
    }
    throw lastError
  }

  private async callListTool(
    apiKey: string,
    parentId: string,
    lastId?: string,
  ): Promise<YoudaoListItem[]> {
    const args: Record<string, unknown> = { parentId }
    if (lastId) args.lastId = lastId
    const text = await this.callTool(apiKey, LIST_TOOL, args)
    return this.parseListItems(text)
  }

  private async callReadTool(apiKey: string, fileId: string): Promise<string> {
    const text = await this.callTool(apiKey, READ_TOOL, { fileId })
    const parsed = this.tryParseJson(text)
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.content === 'string') return obj.content
    }
    return text
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async connect(apiKey: string): Promise<Client> {
    const authHeaders = { 'x-api-key': apiKey }
    const transport = new SSEClientTransport(new URL(MCP_URL), {
      eventSourceInit: {
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string>),
              ...authHeaders,
            },
          }),
      },
      requestInit: {
        headers: authHeaders,
      },
    })

    const client = new Client({ name: 'membot', version: '1.0.0' })
    await client.connect(transport)
    return client
  }

  private extractText(result: unknown): string {
    if (!result || typeof result !== 'object') return ''
    const content = (result as { content?: Array<{ type?: string; text?: string }> })
      .content
    if (!content?.length) return ''
    return content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n')
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private parseListItems(text: string): YoudaoListItem[] {
    const parsed = this.tryParseJson(text)
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).entries ??
          (parsed as Record<string, unknown>).items ??
          (parsed as Record<string, unknown>).files ??
          (parsed as Record<string, unknown>).data ??
          [])
        : []

    if (!Array.isArray(rows)) return []

    return rows
      .map((row) => this.normalizeListItem(row))
      .filter((item): item is YoudaoListItem => !!item)
  }

  private normalizeListItem(row: unknown): YoudaoListItem | null {
    if (!row || typeof row !== 'object') return null
    const obj = row as Record<string, unknown>
    const id = String(obj.id ?? obj.fileId ?? obj.noteId ?? '')
    if (!id) return null

    const title = String(obj.name ?? obj.title ?? obj.fileName ?? id)

    if (obj.dir === true) {
      return { id, title, type: 'folder', raw: obj }
    }
    if (obj.dir === false) {
      return { id, title, type: 'file', raw: obj }
    }

    const typeRaw = String(
      obj.type ?? obj.kind ?? obj.entryType ?? obj.resourceType ?? '',
    ).toLowerCase()

    if (typeRaw.includes('todo') || typeRaw.includes('task')) return null

    const isFolder =
      typeRaw.includes('folder') ||
      typeRaw.includes('dir') ||
      typeRaw === 'directory' ||
      obj.isDir === true ||
      obj.isdir === true ||
      obj.folder === true

    return {
      id,
      title,
      type: isFolder ? 'folder' : 'file',
      raw: obj,
    }
  }
}

import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatOpenAI } from '@langchain/openai'
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { createAgent, summarizationMiddleware } from 'langchain'
import { MemoryClient } from 'mem0ai'
import { HybridSearchService } from '../knowledge/retrieval/hybrid-search.service'
import { RedisService } from '../redis/redis.service'
import { SessionsService } from '../sessions/sessions.service'
import {
  AGENT_SYSTEM_PROMPT,
  SUMMARY_PROMPT,
  memorySchema,
  type MemoryClassification,
} from './prompts/memory.prompts'
import {
  Mem0MemoryStore,
  type Mem0SearchResult,
  messagesForRedis,
} from './stores/mem0-memory.store'
import { RedisMessageStore } from './stores/redis-message.store'

export interface StreamEvent {
  type: 'token' | 'done' | 'meta'
  content?: string
  meta?: Record<string, unknown>
}

const MEMORY_CLASSIFIER_MODEL = 'google/gemma-3-4b-it:free'

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name)
  private agent: ReturnType<typeof createAgent> | null = null
  private redisStore!: RedisMessageStore
  private mem0Store!: Mem0MemoryStore
  private ready = false

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly sessions: SessionsService,
    private readonly knowledgeSearch: HybridSearchService,
  ) {}

  async onModuleInit() {
    const apiKey =
      this.config.get<string>('OPENAI_API_KEY') ??
      this.config.get<string>('OPENROUTER_API_KEY')
    const mem0Key = this.config.get<string>('MEM0_API_KEY')
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY / OPENROUTER_API_KEY 未配置，流式对话不可用',
      )
      return
    }
    if (!mem0Key) {
      this.logger.warn('MEM0_API_KEY 未配置，长期记忆已禁用')
    }

    const ttl = Number(this.config.get('MEMORY_TTL_SECONDS') ?? 1800)
    const keyPrefix =
      this.config.get<string>('MEMORY_KEY_PREFIX') ?? 'agent:short_memory'

    this.redisStore = new RedisMessageStore(
      this.redis.getClient(),
      keyPrefix,
      ttl,
    )

    const baseURL =
      this.config.get<string>('OPENAI_BASE_URL') ??
      this.config.get<string>('OPENROUTER_BASE_URL')

    const llmOpts = {
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
      temperature: 0,
      streaming: true,
    }

    const modelName =
      this.config.get<string>('MODEL_NAME') ??
      this.config.get<string>('OPENROUTER_MODEL') ??
      'google/gemma-4-31b-it:free'
    const model = new ChatOpenAI({ model: modelName, ...llmOpts })

    const classifier = new ChatOpenAI({
      model: MEMORY_CLASSIFIER_MODEL,
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
      temperature: 0,
      streaming: false,
    }).withStructuredOutput(memorySchema) as {
      invoke: (messages: BaseMessage[]) => Promise<MemoryClassification>
    }

    const topK = Number(this.config.get('MEM0_TOP_K') ?? 5)

    if (mem0Key) {
      const mem0 = new MemoryClient({ apiKey: mem0Key })
      this.mem0Store = new Mem0MemoryStore(mem0, topK, classifier)
    } else {
      this.mem0Store = new NoopMem0MemoryStore()
    }

    this.agent = createAgent({
      model,
      tools: [],
      systemPrompt: AGENT_SYSTEM_PROMPT,
      middleware: [
        summarizationMiddleware({
          model,
          summaryPrompt: SUMMARY_PROMPT,
          trigger: { messages: 8 },
          keep: { messages: 4 },
        }),
      ],
    })

    this.ready = true
    this.logger.log('Chat agent initialized (Redis + Mem0 + Knowledge + LLM)')
  }

  async *streamChat(
    sessionId: string,
    userText: string,
    userId: string,
  ): AsyncGenerator<StreamEvent> {
    if (!this.ready || !this.agent) {
      throw new ServiceUnavailableException(
        '对话服务未就绪，请检查 OPENAI_API_KEY / OPENROUTER_API_KEY',
      )
    }

    await this.sessions.assertSessionOwner(sessionId, userId)

    const history = await this.redisStore.loadMessages(sessionId)
    const searchTopK = Number(this.config.get('SEARCH_TOP_K') ?? 10) || 10
    const prefetchStarted = Date.now()

    const [mem, knowledge] = await Promise.all([
      this.mem0Store.search(userId, userText, sessionId),
      this.knowledgeSearch.search(userText, {
        userId,
        topK: searchTopK,
      }),
    ])

    const prefetchMs = Date.now() - prefetchStarted
    const memoryMsg = this.mem0Store.buildSystemMessage(mem)
    const knowledgeMsg = this.knowledgeSearch.buildContextMessage(knowledge.hits)

    const invokeMessages: BaseMessage[] = [
      ...(memoryMsg ? [memoryMsg] : []),
      ...(knowledgeMsg ? [new SystemMessage(knowledgeMsg)] : []),
      ...history,
      new HumanMessage(userText),
    ]

    yield {
      type: 'meta',
      meta: {
        redisHistory: history.length,
        mem0User: mem.user.length,
        mem0Session: mem.session.length,
        knowledgeHits: knowledge.hits.length,
        knowledgeChannels: knowledge.channels,
        prefetchMs,
      },
    }

    const stream = await this.agent.stream(
      { messages: invokeMessages },
      { streamMode: ['messages', 'values'], recursionLimit: 30 },
    )

    let lastAiText = ''
    let finalMessages: BaseMessage[] = invokeMessages

    for await (const chunk of stream) {
      if (!Array.isArray(chunk) || chunk.length < 2) continue

      if (chunk[0] === 'messages') {
        const [message] = chunk[1] as [BaseMessage, Record<string, unknown>?]
        if (!message || !AIMessageChunk.isInstance(message)) continue

        const delta = extractText(message.content)
        if (!delta) continue

        lastAiText += delta
        yield { type: 'token', content: delta }
        continue
      }

      if (chunk[0] === 'values') {
        const state = chunk[1] as { messages?: BaseMessage[] }
        if (state?.messages?.length) {
          finalMessages = state.messages
        }
      }
    }

    const assistantText =
      lastAiText || extractText(finalMessages.at(-1)?.content) || ''

    const redisMessages = messagesForRedis(finalMessages)
    await this.redisStore.saveMessages(sessionId, redisMessages)
    await this.sessions.addMessage(sessionId, 'user', userText)
    await this.sessions.addMessage(sessionId, 'assistant', assistantText)

    yield {
      type: 'done',
      meta: {
        redisCount: redisMessages.length,
        mem0Pending: true,
      },
    }

    void this.mem0Store
      .classifyAndPersist(userId, sessionId, userText, assistantText)
      .then(({ written, reason }) => {
        this.logger.debug(
          `Mem0 classify done session=${sessionId} written=[${written.join(',')}] reason=${reason}`,
        )
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Mem0 classify failed session=${sessionId}: ${message}`)
      })
  }
}

class NoopMem0MemoryStore extends Mem0MemoryStore {
  constructor() {
    super({} as MemoryClient, 0, {
      invoke: async () => ({
        write_user: false,
        write_session: false,
        reason: 'mem0 disabled',
      }),
    })
  }

  override async search(
    _userId: string,
    _query: string,
    _sessionId: string,
  ): Promise<Mem0SearchResult> {
    return { user: [], session: [] }
  }

  override async classifyAndPersist(
    _userId: string,
    _sessionId: string,
    _userText: string,
    _assistantText: string,
  ): Promise<{ written: string[]; reason: string }> {
    return { written: [], reason: 'mem0 disabled' }
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'object' && c && 'text' in c
          ? String((c as { text: string }).text)
          : '',
      )
      .join('')
  }
  return String(content ?? '')
}

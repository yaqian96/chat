import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import { RedisService } from '../redis/redis.service'
import { groupSessionsByDate } from './utils/group-history'
import type {
  HistoryGroup,
  SessionDetail,
  SessionMessage,
  SessionMeta,
} from './types'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly logger = new Logger(SessionsService.name)
  private useMemory = false

  private readonly memorySessions = new Map<string, SessionMeta>()
  private readonly memoryMessages = new Map<string, SessionMessage[]>()
  private readonly memoryUserIndex = new Map<string, string[]>()

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    this.useMemory = !this.redis.isAvailable()
    if (this.useMemory) {
      this.logger.warn('Using in-memory session store')
    }
  }

  private userSessionsKey(userId: string): string {
    return `user:${userId}:sessions`
  }

  private sessionKey(sessionId: string): string {
    return `session:${sessionId}`
  }

  private sessionMessagesKey(sessionId: string): string {
    return `session:${sessionId}:messages`
  }

  async assertSessionOwner(
    sessionId: string,
    userId: string,
  ): Promise<SessionMeta> {
    const meta = await this.getSessionMeta(sessionId)
    if (!meta) {
      throw new NotFoundException(`Session ${sessionId} not found`)
    }
    if (meta.userId !== userId) {
      throw new ForbiddenException('无权访问该会话')
    }
    return meta
  }

  async getHistory(userId: string): Promise<HistoryGroup[]> {
    const uid = userId

    if (this.useMemory) {
      const ids = this.memoryUserIndex.get(uid) ?? []
      const sessions = ids
        .map((id) => this.memorySessions.get(id))
        .filter((s): s is SessionMeta => !!s)
      return groupSessionsByDate(sessions)
    }

    const client = this.redis.getClient()
    const sessionIds = await client.zrevrange(this.userSessionsKey(uid), 0, -1)

    const sessions: SessionMeta[] = []
    for (const id of sessionIds) {
      const meta = await this.getSessionMeta(id)
      if (meta) sessions.push(meta)
    }

    return groupSessionsByDate(sessions)
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const meta = await this.getSessionMeta(sessionId)
    if (!meta) {
      throw new NotFoundException(`Session ${sessionId} not found`)
    }

    const messages = await this.getMessages(sessionId)
    return { ...meta, messages }
  }

  async createSession(userId: string, title = '新对话'): Promise<SessionDetail> {
    const uid = userId
    const now = new Date().toISOString()
    const id = uuidv4()

    const meta: SessionMeta = {
      id,
      userId: uid,
      title,
      createdAt: now,
      updatedAt: now,
    }

    if (this.useMemory) {
      this.memorySessions.set(id, meta)
      this.memoryMessages.set(id, [])
      const index = this.memoryUserIndex.get(uid) ?? []
      this.memoryUserIndex.set(uid, [id, ...index.filter((x) => x !== id)])
      return { ...meta, messages: [] }
    }

    const client = this.redis.getClient()
    await client
      .multi()
      .set(this.sessionKey(id), JSON.stringify(meta), 'EX', SESSION_TTL_SECONDS)
      .zadd(this.userSessionsKey(uid), Date.now(), id)
      .exec()

    return { ...meta, messages: [] }
  }

  async addMessage(
    sessionId: string,
    role: SessionMessage['role'],
    content: string,
  ): Promise<SessionMessage> {
    const meta = await this.getSessionMeta(sessionId)
    if (!meta) {
      throw new NotFoundException(`Session ${sessionId} not found`)
    }

    const message: SessionMessage = {
      id: uuidv4(),
      role,
      content,
      createdAt: new Date().toISOString(),
    }

    const now = new Date().toISOString()
    const updatedMeta: SessionMeta = {
      ...meta,
      updatedAt: now,
      title:
        meta.title === '新对话' && role === 'user'
          ? content.slice(0, 30) + (content.length > 30 ? '...' : '')
          : meta.title,
    }

    if (this.useMemory) {
      this.memorySessions.set(sessionId, updatedMeta)
      const msgs = this.memoryMessages.get(sessionId) ?? []
      msgs.push(message)
      this.memoryMessages.set(sessionId, msgs)
      const index = this.memoryUserIndex.get(meta.userId) ?? []
      this.memoryUserIndex.set(meta.userId, [
        sessionId,
        ...index.filter((x) => x !== sessionId),
      ])
      return message
    }

    const client = this.redis.getClient()
    await client
      .multi()
      .rpush(this.sessionMessagesKey(sessionId), JSON.stringify(message))
      .expire(this.sessionMessagesKey(sessionId), SESSION_TTL_SECONDS)
      .set(
        this.sessionKey(sessionId),
        JSON.stringify(updatedMeta),
        'EX',
        SESSION_TTL_SECONDS,
      )
      .zadd(this.userSessionsKey(meta.userId), Date.now(), sessionId)
      .exec()

    return message
  }

  async deleteSession(sessionId: string): Promise<void> {
    const meta = await this.getSessionMeta(sessionId)
    if (!meta) {
      throw new NotFoundException(`Session ${sessionId} not found`)
    }

    if (this.useMemory) {
      this.memorySessions.delete(sessionId)
      this.memoryMessages.delete(sessionId)
      const index = this.memoryUserIndex.get(meta.userId) ?? []
      this.memoryUserIndex.set(
        meta.userId,
        index.filter((x) => x !== sessionId),
      )
      return
    }

    const client = this.redis.getClient()
    await client
      .multi()
      .del(this.sessionKey(sessionId))
      .del(this.sessionMessagesKey(sessionId))
      .zrem(this.userSessionsKey(meta.userId), sessionId)
      .exec()
  }

  private async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    if (this.useMemory) {
      return this.memorySessions.get(sessionId) ?? null
    }

    const client = this.redis.getClient()
    const raw = await client.get(this.sessionKey(sessionId))
    
    if (!raw) return null
    
    // 🔥 滑动 TTL：每次访问时刷新 90 天，让活跃会话永不过期
    await client.expire(this.sessionKey(sessionId), SESSION_TTL_SECONDS)
    await client.expire(this.sessionMessagesKey(sessionId), SESSION_TTL_SECONDS)
    
    return JSON.parse(raw) as SessionMeta
  }

  private async getMessages(sessionId: string): Promise<SessionMessage[]> {
    if (this.useMemory) {
      return this.memoryMessages.get(sessionId) ?? []
    }

    const rawList = await this.redis
      .getClient()
      .lrange(this.sessionMessagesKey(sessionId), 0, -1)
    return rawList.map((raw) => JSON.parse(raw) as SessionMessage)
  }
}

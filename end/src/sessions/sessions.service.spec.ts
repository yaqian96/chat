import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { SessionsService } from './sessions.service'
import { RedisService } from '../redis/redis.service'

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-123'),
}))

function createMocks() {
  const multiChain = {
    set: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    zrem: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    rpush: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }

  const client = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    zrevrange: jest.fn(),
    zadd: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    rpush: jest.fn().mockResolvedValue(1),
    lrange: jest.fn(),
    expire: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue(multiChain),
  }

  return { client, multiChain }
}

describe('SessionsService', () => {
  let service: SessionsService
  let mockRedis: { isAvailable: jest.Mock; getClient: jest.Mock }
  let mocks: ReturnType<typeof createMocks>

  beforeEach(async () => {
    mocks = createMocks()
    mockRedis = {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(mocks.client),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile()

    service = module.get<SessionsService>(SessionsService)
    await service.onModuleInit()
  })

  describe('createSession', () => {
    it('应该成功创建新会话', async () => {
      const result = await service.createSession('user-123', '测试会话')

      expect(result).toMatchObject({
        id: 'mock-uuid-123',
        userId: 'user-123',
        title: '测试会话',
        messages: [],
      })
      expect(mocks.client.multi).toHaveBeenCalled()
      expect(mocks.multiChain.exec).toHaveBeenCalled()
    })

    it('默认标题应为"新对话"', async () => {
      const result = await service.createSession('user-123')
      expect(result.title).toBe('新对话')
    })

    it('第一条用户消息后应更新标题', async () => {
      mocks.client.get.mockResolvedValueOnce(
        JSON.stringify({
          id: 'session-123',
          userId: 'user-123',
          title: '新对话',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }),
      )

      await service.addMessage('session-123', 'user', '这是一条很长的用户消息超过30个字了')

      expect(mocks.client.multi).toHaveBeenCalled()
    })
  })

  describe('getSession', () => {
    it('应该返回会话详情和消息列表', async () => {
      const mockMeta = {
        id: 'session-123',
        userId: 'user-123',
        title: '测试会话',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
      mocks.client.get.mockResolvedValueOnce(JSON.stringify(mockMeta))
      mocks.client.lrange.mockResolvedValue([
        JSON.stringify({ id: 'msg-1', role: 'user', content: '你好', createdAt: '2024-01-01T00:00:00.000Z' }),
        JSON.stringify({ id: 'msg-2', role: 'assistant', content: '你好！', createdAt: '2024-01-01T00:00:01.000Z' }),
      ])

      const result = await service.getSession('session-123')

      expect(result).toMatchObject({
        ...mockMeta,
        messages: expect.any(Array),
      })
      expect(result.messages).toHaveLength(2)
    })

    it('会话不存在时应抛出 NotFoundException', async () => {
      mocks.client.get.mockResolvedValueOnce(null)

      await expect(service.getSession('nonexistent')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('assertSessionOwner', () => {
    it('会话所有者应能正常访问', async () => {
      const mockMeta = {
        id: 'session-123',
        userId: 'user-123',
        title: '测试',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
      mocks.client.get.mockResolvedValueOnce(JSON.stringify(mockMeta))

      const result = await service.assertSessionOwner('session-123', 'user-123')

      expect(result).toMatchObject(mockMeta)
    })

    it('非所有者访问时应抛出 ForbiddenException', async () => {
      const mockMeta = {
        id: 'session-123',
        userId: 'user-123',
        title: '测试',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
      mocks.client.get.mockResolvedValueOnce(JSON.stringify(mockMeta))

      await expect(
        service.assertSessionOwner('session-123', 'other-user'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('会话不存在时应抛出 NotFoundException', async () => {
      mocks.client.get.mockResolvedValueOnce(null)

      await expect(
        service.assertSessionOwner('nonexistent', 'user-123'),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('deleteSession', () => {
    it('应该成功删除会话', async () => {
      const mockMeta = {
        id: 'session-123',
        userId: 'user-123',
        title: '测试',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
      mocks.client.get.mockResolvedValueOnce(JSON.stringify(mockMeta))

      await expect(service.deleteSession('session-123')).resolves.not.toThrow()
      expect(mocks.client.multi).toHaveBeenCalled()
    })

    it('删除不存在会话时应抛出 NotFoundException', async () => {
      mocks.client.get.mockResolvedValueOnce(null)

      await expect(service.deleteSession('nonexistent')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('addMessage', () => {
    it('应该成功添加消息', async () => {
      const mockMeta = {
        id: 'session-123',
        userId: 'user-123',
        title: '新对话',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
      mocks.client.get.mockResolvedValueOnce(JSON.stringify(mockMeta))

      const result = await service.addMessage('session-123', 'user', '测试消息')

      expect(result).toMatchObject({
        id: 'mock-uuid-123',
        role: 'user',
        content: '测试消息',
        createdAt: expect.any(String),
      })
    })

    it('添加到不存在会话时应抛出 NotFoundException', async () => {
      mocks.client.get.mockResolvedValueOnce(null)

      await expect(
        service.addMessage('nonexistent', 'user', '测试消息'),
      ).rejects.toThrow(NotFoundException)
    })
  })
})

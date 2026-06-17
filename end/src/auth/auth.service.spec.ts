import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { DatabaseService } from '../database/database.service'
import * as bcrypt from 'bcrypt'

// Mock bcrypt
jest.mock('bcrypt')

describe('AuthService', () => {
  let service: AuthService
  let mockDb: Partial<DatabaseService>
  let mockJwt: Partial<JwtService>
  let mockConfig: Partial<ConfigService>

  const mockPool = {
    query: jest.fn(),
  }

  beforeEach(async () => {
    mockPool.query = jest.fn()

    mockDb = {
      isAvailable: jest.fn().mockReturnValue(true),
      getPool: jest.fn().mockReturnValue(mockPool),
    }

    mockJwt = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    }

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_EXPIRES_SECONDS') return '604800'
        return null
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('register', () => {
    const registerDto = { email: 'test@example.com', password: 'password123' }

    it('应该成功注册新用户', async () => {
      const mockUser = { id: 'user-uuid-123', email: 'test@example.com' }
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password')
      mockPool.query.mockResolvedValue({ rows: [mockUser] })

      const result = await service.register(registerDto)

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: { id: mockUser.id, email: mockUser.email },
      })
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10)
      expect(mockPool.query).toHaveBeenCalled()
    })

    it('邮箱已存在时应抛出 ConflictException', async () => {
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password')
      mockPool.query.mockRejectedValue({ code: '23505' })

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      )
    })

    it('数据库不可用时应抛出 ServiceUnavailableException', async () => {
      ;(mockDb.isAvailable as jest.Mock).mockReturnValue(false)

      await expect(service.register(registerDto)).rejects.toThrow(
        ServiceUnavailableException,
      )
    })

    it('应该将邮箱转为小写并去除空格', async () => {
      const dtoWithSpaces = { email: '  Test@EXAMPLE.COM  ', password: 'password123' }
      const mockUser = { id: 'user-uuid', email: 'test@example.com' }
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password')
      mockPool.query.mockResolvedValue({ rows: [mockUser] })

      await service.register(dtoWithSpaces)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['test@example.com', 'hashed-password'],
      )
    })
  })

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' }

    it('应该成功登录并返回 token', async () => {
      const mockRow = {
        id: 'user-uuid-123',
        email: 'test@example.com',
        password_hash: 'hashed-password',
        status: 'active',
      }
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      mockPool.query.mockResolvedValue({ rows: [mockRow] })

      const result = await service.login(loginDto)

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: { id: mockRow.id, email: mockRow.email },
      })
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password')
    })

    it('用户不存在时应抛出 UnauthorizedException', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      )
    })

    it('密码错误时应抛出 UnauthorizedException', async () => {
      const mockRow = {
        id: 'user-uuid',
        email: 'test@example.com',
        password_hash: 'wrong-hash',
        status: 'active',
      }
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)
      mockPool.query.mockResolvedValue({ rows: [mockRow] })

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      )
    })

    it('账号被禁用时应抛出 UnauthorizedException', async () => {
      const mockRow = {
        id: 'user-uuid',
        email: 'test@example.com',
        password_hash: 'hashed-password',
        status: 'disabled',
      }
      mockPool.query.mockResolvedValue({ rows: [mockRow] })

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      )
    })
  })

  describe('me', () => {
    it('应该返回当前用户信息', () => {
      const user = { id: 'user-123', email: 'test@example.com' }
      const result = service.me(user)
      expect(result).toEqual(user)
    })
  })
})

import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { DatabaseService } from '../database/database.service'
import type { AuthResponse, AuthUser } from './types'
import type { LoginDto } from './dto/login.dto'
import type { RegisterDto } from './dto/register.dto'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const pool = this.requirePool()
    const email = dto.email.trim().toLowerCase()
    const passwordHash = await bcrypt.hash(dto.password, 10)

    try {
      const { rows } = await pool.query<{ id: string; email: string }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email`,
        [email, passwordHash],
      )
      const user = rows[0]
      return this.buildAuthResponse(user.id, user.email)
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('该邮箱已注册')
      }
      throw err
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const pool = this.requirePool()
    const email = dto.email.trim().toLowerCase()

    const { rows } = await pool.query<{
      id: string
      email: string
      password_hash: string
      status: string
    }>(
      `SELECT id, email, password_hash, status FROM users WHERE email = $1`,
      [email],
    )

    const row = rows[0]
    if (!row || row.status !== 'active') {
      throw new UnauthorizedException('邮箱或密码错误')
    }

    const ok = await bcrypt.compare(dto.password, row.password_hash)
    if (!ok) {
      throw new UnauthorizedException('邮箱或密码错误')
    }

    return this.buildAuthResponse(row.id, row.email)
  }

  me(user: AuthUser): AuthUser {
    return user
  }

  private buildAuthResponse(id: string, email: string): AuthResponse {
    const expiresIn =
      Number(this.config.get('JWT_EXPIRES_SECONDS') ?? 60 * 60 * 24 * 7) ||
      60 * 60 * 24 * 7
    const accessToken = this.jwt.sign({ sub: id, email }, { expiresIn })
    return {
      accessToken,
      user: { id, email },
    }
  }

  private requirePool() {
    if (!this.db.isAvailable()) {
      throw new ServiceUnavailableException('数据库不可用，无法登录')
    }
    return this.db.getPool()
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    )
  }
}

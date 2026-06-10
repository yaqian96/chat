import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { AuthUser, JwtPayload } from './types'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET') ?? 'membot-dev-secret-change-me'
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    })
  }

  validate(payload: JwtPayload): AuthUser {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('无效的登录凭证')
    }
    return { id: payload.sub, email: payload.email }
  }
}

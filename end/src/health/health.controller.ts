import { Controller, Get } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'

@Controller('health')
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  @Get()
  check() {
    const redis = this.redis.isAvailable()
    return {
      status: redis ? 'ok' : 'degraded',
      redis,
      message: redis
        ? 'All services healthy'
        : 'Redis unavailable, using in-memory session store',
    }
  }
}

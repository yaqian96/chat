import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { resolve } from 'path'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { ChatModule } from './chat/chat.module'
import { DatabaseModule } from './database/database.module'
import { KnowledgeModule } from './knowledge/knowledge.module'
import { HealthModule } from './health/health.module'
import { RedisModule } from './redis/redis.module'
import { SessionsModule } from './sessions/sessions.module'

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, '../../.env'),
        resolve(__dirname, '../.env'),
      ],
    }),
    DatabaseModule,
    AuthModule,
    RedisModule,
    SessionsModule,
    ChatModule,
    KnowledgeModule,
    HealthModule,
  ],
})
export class AppModule {}

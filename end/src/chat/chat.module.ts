import { Module } from '@nestjs/common'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { SessionsModule } from '../sessions/sessions.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'

@Module({
  imports: [SessionsModule, KnowledgeModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}

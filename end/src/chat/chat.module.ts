import { Module } from '@nestjs/common'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { SessionsModule } from '../sessions/sessions.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { FactChecker } from './services/fact-checker.service'

@Module({
  imports: [SessionsModule, KnowledgeModule],
  controllers: [ChatController],
  providers: [ChatService, FactChecker],
  exports: [ChatService],
})
export class ChatModule {}

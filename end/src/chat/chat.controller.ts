import {
  Body,
  Controller,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthUser } from '../auth/types'
import { ChatStreamDto } from './dto/chat-stream.dto'
import { ChatService } from './chat.service'

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post(':id/chat/stream')
  async streamChat(
    @Param('id') sessionId: string,
    @Body() dto: ChatStreamDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const flush = () => {
      const maybeFlush = res as Response & { flush?: () => void }
      maybeFlush.flush?.()
    }

    try {
      for await (const event of this.chatService.streamChat(
        sessionId,
        dto.message,
        user.id,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
        flush()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      res.write(
        `data: ${JSON.stringify({ type: 'error', content: message })}\n\n`,
      )
    }

    res.end()
  }
}

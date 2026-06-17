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

    // 创建 AbortController 用于中断信号
    const abortController = new AbortController()

    // 监听客户端断开连接
    res.on('close', () => {
      // 如果响应未完成（非正常结束），说明客户端主动断开
      if (!res.writableEnded) {
        abortController.abort()
      }
    })

    try {
      for await (const event of this.chatService.streamChat(
        sessionId,
        dto.message,
        user.id,
        { signal: abortController.signal },
      )) {
        // 如果已中断，停止发送
        if (abortController.signal.aborted) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
          flush()
          break
        }

        res.write(`data: ${JSON.stringify(event)}\n\n`)
        flush()
      }
    } catch (err) {
      // 如果是 AbortError，不发送错误信息
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      res.write(
        `data: ${JSON.stringify({ type: 'error', content: message })}\n\n`,
      )
    }

    res.end()
  }
}

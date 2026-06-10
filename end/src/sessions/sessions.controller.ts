import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthUser } from '../auth/types'
import { CreateMessageDto } from './dto/create-message.dto'
import { CreateSessionDto } from './dto/create-session.dto'
import { SessionsService } from './sessions.service'

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('history')
  getHistory(@CurrentUser() user: AuthUser) {
    return this.sessionsService.getHistory(user.id)
  }

  @Get(':id')
  async getSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.sessionsService.assertSessionOwner(id, user.id)
    return this.sessionsService.getSession(id)
  }

  @Post()
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.createSession(user.id, dto.title)
  }

  @Post(':id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.sessionsService.assertSessionOwner(id, user.id)
    return this.sessionsService.addMessage(id, dto.role, dto.content)
  }

  @Delete(':id')
  async deleteSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.sessionsService.assertSessionOwner(id, user.id)
    return this.sessionsService.deleteSession(id)
  }
}

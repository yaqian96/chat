import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthUser } from '../auth/types'
import { YoudaoConfigDto } from './dto/youdao-config.dto'
import { KnowledgeService } from './knowledge.service'

@Controller('knowledge/youdao')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.knowledge.getYoudaoConfig(user.id)
  }

  @Put('config')
  saveConfig(@Body() dto: YoudaoConfigDto, @CurrentUser() user: AuthUser) {
    return this.knowledge.saveYoudaoConfig(dto, user.id)
  }

  @Post('test')
  testConnection(@CurrentUser() user: AuthUser) {
    return this.knowledge.testYoudaoConnection(user.id)
  }

  @Post('sync')
  syncNotes(@CurrentUser() user: AuthUser) {
    return this.knowledge.syncYoudaoNotes(user.id)
  }

  @Get('status')
  getStatus(@CurrentUser() user: AuthUser) {
    return this.knowledge.getYoudaoStatus(user.id)
  }
}

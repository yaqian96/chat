import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthUser } from '../auth/types'
import { SearchDto } from './dto/search.dto'
import { HybridSearchService } from './retrieval/hybrid-search.service'
import { IndexSyncService } from './retrieval/index-sync.service'

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(
    private readonly search: HybridSearchService,
    private readonly indexSync: IndexSyncService,
  ) {}

  @Post('search')
  searchKnowledge(@Body() dto: SearchDto, @CurrentUser() user: AuthUser) {
    return this.search.search(dto.query, { userId: user.id, topK: dto.topK })
  }

  @Post('search/reindex')
  reindex(@CurrentUser() user: AuthUser) {
    return this.indexSync.reindexUser(user.id)
  }
}

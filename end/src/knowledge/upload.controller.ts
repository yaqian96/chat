import {
  Controller,
  Get,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { AuthUser } from '../auth/types'
import { UploadService } from './upload.service'

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: {
        fileSize:
          (Number(process.env.UPLOAD_MAX_SIZE_MB) || 20) * 1024 * 1024,
      },
    }),
  )
  uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.upload.uploadFiles(files, user.id)
  }

  @Post('ingest/retry')
  retryFailed(@CurrentUser() user: AuthUser) {
    return this.upload.retryFailed(user.id)
  }

  @Get('ingest/status')
  getIngestStatus(@CurrentUser() user: AuthUser) {
    return this.upload.getIngestStatus(user.id)
  }
}

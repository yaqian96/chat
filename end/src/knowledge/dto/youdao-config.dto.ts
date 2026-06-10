import { IsOptional, IsString } from 'class-validator'

export class YoudaoConfigDto {
  @IsOptional()
  @IsString()
  apiKey?: string

  @IsOptional()
  @IsString()
  folderId?: string
}

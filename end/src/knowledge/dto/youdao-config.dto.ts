import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class YoudaoConfigDto {
  @IsOptional()
  @IsString()
  apiKey?: string

  @IsOptional()
  @IsString()
  folderId?: string

  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  syncIntervalMinutes?: number
}

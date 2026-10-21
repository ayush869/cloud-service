import { ProjectStatus, Visibility } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SLUG_PATTERN } from '../../common/utils/slug';

export class ProjectSettingsDto {
  /** Visibility for uploads that do not specify one. PUBLIC files get a permanent CDN-style URL. */
  @IsOptional()
  @IsEnum(Visibility)
  defaultVisibility?: Visibility;

  /** Per-project cap below the server-wide MAX_UPLOAD_SIZE_BYTES. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUploadBytes?: number | null;

  /** Whitelist of extensions (without dot). Empty/null = anything not globally blocked. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(/^[a-z0-9]{1,16}$/, { each: true })
  allowedExtensions?: string[] | null;
}

export class CreateProjectDto {
  @IsString()
  @Length(1, 150)
  name: string;

  /** URL-safe identifier, unique per tenant, used in public URLs. Generated from the name if omitted. Cannot be changed later. */
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug may contain lowercase letters, digits and dashes' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** e.g. ["https://abc.com", "https://www.abc.com"] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }, { each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectSettingsDto)
  settings?: ProjectSettingsDto;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }, { each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectSettingsDto)
  settings?: ProjectSettingsDto;
}

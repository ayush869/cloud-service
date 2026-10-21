import { Visibility } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQuery } from '../../common/utils/pagination';

export class ListFilesQuery extends PageQuery {
  /** Folder id, or "root" for files at the project root. Omit to search the whole project. */
  @IsOptional()
  @ValidateIf((_, v) => v !== 'root')
  @IsUUID()
  folderId?: string;

  /** Substring match on the file name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Only files whose full path starts with this (S3-style prefix listing). */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  prefix?: string;

  /** Exact type ("image/png") or family ("image/*"). */
  @IsOptional()
  @IsString()
  @MaxLength(127)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  extension?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minSize?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxSize?: number;
  @IsOptional() @Type(() => Date) @IsDate() createdFrom?: Date;
  @IsOptional() @Type(() => Date) @IsDate() createdTo?: Date;
  @IsOptional() @Type(() => Date) @IsDate() updatedFrom?: Date;
  @IsOptional() @Type(() => Date) @IsDate() updatedTo?: Date;

  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt', 'sizeBytes'])
  sort: 'name' | 'createdAt' | 'updatedAt' | 'sizeBytes' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export class UpdateFileDto {
  /** New name (rename). Only metadata changes - the stored object is untouched. */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}

export class MoveFileDto {
  /** Destination folder; null = project root. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  targetFolderId: string | null;
}

export class CopyFileDto {
  /** Destination folder; null/omitted = same folder as the source. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  targetFolderId?: string | null;

  /** Name of the copy; defaults to the source name, numbered if taken ("photo (1).jpg"). */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  newName?: string;
}

export class BulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class BulkMoveDto extends BulkIdsDto {
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  targetFolderId: string | null;
}

export class DownloadQuery {
  /** Signed link to a WebP rendition instead of the original (images only). */
  @IsOptional()
  @IsIn(['thumb', 'small', 'medium', 'large'])
  variant?: string;

  /** inline = display in the browser when the type is safe; attachment = force download. */
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  disposition: 'inline' | 'attachment' = 'attachment';

  /** Link lifetime in seconds (max = DOWNLOAD_URL_EXPIRES * 12). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  expiresIn?: number;
}

export const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1' || value === 1;

export class PathQuery {
  /** Full logical path, e.g. "jewel-pilot/images/banner-image/a.jpg". */
  @IsString()
  @Length(1, 1024)
  path: string;
}

export class DeleteByPathQuery extends PathQuery {
  /** Skip the trash and free the bytes immediately. */
  @IsOptional()
  @Transform(toBool)
  permanent?: boolean;
}

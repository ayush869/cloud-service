import { Visibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export type ConflictStrategy = 'error' | 'rename' | 'overwrite';

export class PresignUploadDto {
  /** File name, e.g. "product.jpg". */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** Declared type, e.g. "image/jpeg". The stored type is decided from the actual bytes. */
  @IsString()
  @MaxLength(127)
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'contentType must look like type/subtype' })
  contentType: string;

  /** Exact size in bytes; the upload must match it. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sizeBytes: number;

  /** Target folder id (null/omitted = root). Alternative to `folderPath`. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId?: string | null;

  /** Target folder path, created if missing, e.g. "images/products". Alternative to `folderId`. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  folderPath?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  /** What to do when the name is taken: rename (default) to "name (1).ext", or error. */
  @IsOptional()
  @IsIn(['error', 'rename'])
  onConflict?: 'error' | 'rename';
}

/** Options for direct uploads (multipart POST /files/upload and PUT /objects). */
export class DirectUploadQuery {
  /** Full path including the file name, e.g. "jewel-pilot/images/banner-image/a.jpg". */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  path?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  folderPath?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsIn(['error', 'rename', 'overwrite'])
  onConflict?: ConflictStrategy;
}

export class UploadContentQuery {
  @IsString()
  @Length(10, 2048)
  token: string;
}

import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 255)
  name: string;

  /** Parent folder; omit or null for the project root. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;
}

export class RenameFolderDto {
  @IsString()
  @Length(1, 255)
  name: string;
}

export class MoveFolderDto {
  /** Destination parent; null moves the folder to the project root. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  targetParentId: string | null;
}

export class ListFoldersQuery {
  /** Lists children of this folder; omitted = root level. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

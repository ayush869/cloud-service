import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { API_KEY_ASSIGNABLE_PERMISSIONS } from '../../common/constants';

export class CreateApiKeyDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Length(1, 150)
  name: string;

  /** Defaults to all files.* and folders.* permissions. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsIn(API_KEY_ASSIGNABLE_PERMISSIONS, { each: true })
  permissions?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ListApiKeysQuery {
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

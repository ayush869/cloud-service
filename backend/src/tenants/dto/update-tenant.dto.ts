import { IsString, Length } from 'class-validator';

export class UpdateTenantDto {
  @IsString()
  @Length(2, 150)
  name: string;
}

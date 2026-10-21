import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export const toSkipTake = (q: PageQuery) => ({ skip: (q.page - 1) * q.limit, take: q.limit });

export const paged = <T>(items: T[], total: number, q: PageQuery) => ({
  items,
  total,
  page: q.page,
  limit: q.limit,
  hasMore: q.page * q.limit < total,
});

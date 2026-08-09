import { CommissionPeriodType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/**
 * По избор ограничава справката до календарен период.
 * И трите полета вървят заедно — без тях справката е за цялото време.
 */
export class ReportQueryDto {
  @IsOptional()
  @IsEnum(CommissionPeriodType)
  periodType?: CommissionPeriodType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  index?: number;
}

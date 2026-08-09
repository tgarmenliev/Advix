import { CommissionStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateCommissionStatusDto {
  @IsEnum(CommissionStatus)
  status!: CommissionStatus;

  /** Реално полученото (стотинки) — може да се различава от очакваното */
  @IsOptional()
  @IsInt()
  @Min(0)
  actualAmount?: number;

  /** Дата на начисляване/получаване */
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

import {
  CommissionLoanCategory,
  CommissionSchemeType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class PeriodQueryDto {
  @IsEnum(CommissionLoanCategory)
  loanCategory!: CommissionLoanCategory;

  @IsEnum(CommissionSchemeType)
  schemeType!: CommissionSchemeType;

  /** Дата, по която се определя периодът и действащата схема (по подр. сега) */
  @IsOptional()
  @IsDateString()
  at?: string;
}

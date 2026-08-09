import {
  CommissionLoanCategory,
  CommissionSchemeType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class ResolveSchemeQueryDto {
  @IsEnum(CommissionSchemeType)
  schemeType!: CommissionSchemeType;

  @IsEnum(CommissionLoanCategory)
  loanCategory!: CommissionLoanCategory;

  /** Към коя дата търсим действащата схема (по подразбиране — сега) */
  @IsOptional()
  @IsDateString()
  at?: string;
}

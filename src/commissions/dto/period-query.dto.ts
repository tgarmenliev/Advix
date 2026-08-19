import {
  CommissionLoanCategory,
  CommissionSchemeType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class PeriodQueryDto {
  @IsEnum(CommissionLoanCategory)
  loanCategory!: CommissionLoanCategory;

  @IsEnum(CommissionSchemeType)
  schemeType!: CommissionSchemeType;

  /** Дата, по която се определя периодът и действащата схема (по подр. сега) */
  @IsOptional()
  @IsDateString()
  at?: string;

  /**
   * Ръчен избор на схема — задължителен, когато банката има повече от една
   * активна схема за тази категория+вид (виж GET .../commission-schemes/active-options).
   */
  @IsOptional()
  @IsUUID()
  schemeId?: string;
}

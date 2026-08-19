import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionLoanCategory,
  CommissionPeriodType,
  CommissionSchemeType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CommissionTierDto } from './commission-tier.dto';

/** bankId идва от URL-а (POST /banks/:bankId/commission-schemes). */
export class CreateCommissionSchemeDto {
  @IsEnum(CommissionSchemeType)
  schemeType!: CommissionSchemeType;

  @IsEnum(CommissionLoanCategory)
  loanCategory!: CommissionLoanCategory;

  @IsDateString()
  validFrom!: string;

  /** Липсва = безсрочна схема */
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsEnum(CommissionBasis)
  basis!: CommissionBasis;

  /** При FLAT_PERCENT: 0.01 = 1.00% */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  flatPercent?: number;

  /** При VOLUME_TIERED — календарно подравнен период за отчитане на обема */
  @IsOptional()
  @IsEnum(CommissionPeriodType)
  periodType?: CommissionPeriodType;

  @IsOptional()
  @IsEnum(CommissionEvaluationMode)
  evaluationMode?: CommissionEvaluationMode;

  /** Таван на комисионата за една сделка (стотинки) */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerDealAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Свободен етикет за подкатегория вътре в loanCategory (напр. "Кредитна
   * линия" срещу "Инвестиционен кредит"). null/липсва = единствената схема за
   * тази комбинация банка+вид+категория.
   */
  @IsOptional()
  @IsString()
  label?: string;

  /** Условия за връщане на вече получена комисиона/бонус — свободен текст */
  @IsOptional()
  @IsString()
  clawbackPolicy?: string;

  /** При VOLUME_TIERED/COUNT_TIERED — скалите по обем или по брой сделки */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommissionTierDto)
  tiers?: CommissionTierDto[];
}

import { CommissionAdjustmentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAdjustmentDto {
  @IsEnum(CommissionAdjustmentType)
  type!: CommissionAdjustmentType;

  /** Стотинки; ОТРИЦАТЕЛНА при clawback */
  @IsInt()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsDateString()
  occurredAt!: string;

  /** По избор — ако корекцията е по конкретна сделка */
  @IsOptional()
  @IsUUID()
  loanApplicationId?: string;

  /**
   * По избор — ако корекцията е по получен ПЕРИОДЕН БОНУС, не по сделка
   * (напр. банка, която при предсрочно погасяване иска обратно тримесечния
   * бонус, не комисионата по конкретния кредит).
   */
  @IsOptional()
  @IsUUID()
  bankPeriodBonusId?: string;
}

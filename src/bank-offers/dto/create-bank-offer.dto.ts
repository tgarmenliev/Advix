import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Параметри на получена банкова оферта.
 * Всички парични стойности са цели числа в стотинки (MASTER_CONTEXT §7);
 * лихвата и ГПР са дробни проценти (напр. 0.035 = 3.50%), защото са
 * коефициенти, не пари.
 */
export class CreateBankOfferDto {
  @IsUUID()
  bankId!: string;

  /** Запитването, по което е получена офертата (ако има такова) */
  @IsOptional()
  @IsUUID()
  inquiryId?: string;

  // --- Парични параметри (стотинки) ---

  @IsOptional() @IsInt() @Min(0) totalRepayment?: number;
  @IsOptional() @IsInt() @Min(0) propertyInsurance?: number;
  @IsOptional() @IsInt() @Min(0) lifeInsurance?: number;
  @IsOptional() @IsInt() @Min(0) propertyValuation?: number;
  @IsOptional() @IsInt() @Min(0) preDisburseeFee?: number;
  @IsOptional() @IsInt() @Min(0) mortgageSetupFee?: number;
  @IsOptional() @IsInt() @Min(0) accountMaintenanceFee?: number;
  @IsOptional() @IsInt() @Min(0) creditCardIssueFee?: number;
  @IsOptional() @IsInt() @Min(0) creditCardMaintenanceFee?: number;
  @IsOptional() @IsInt() @Min(0) monthlyPayment?: number;

  /** Обявено от банката общо плащане — сравнява се с изчисленото */
  @IsOptional() @IsInt() @Min(0) totalPayment?: number;

  // --- Проценти и срок ---

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  interestRate?: number; // 0.035 = 3.50%

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  apr?: number; // ГПР

  @IsOptional() @IsInt() @Min(1) termMonths?: number;

  // --- Свободен текст ---

  @IsOptional() @IsString() additionalConditions?: string;
  @IsOptional() @IsString() comments?: string;
}

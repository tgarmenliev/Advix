import { LoanType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateLoanApplicationDto {
  @IsUUID()
  clientId!: string;

  @IsEnum(LoanType)
  loanType!: LoanType;

  @IsInt()
  @Min(1)
  amount!: number; // стотинки

  @IsInt()
  @Min(1)
  termMonths!: number;

  @IsOptional()
  @IsString()
  purpose?: string;

  /** Игнорира се за CONSULTANT/PARTNER_* — взима се от текущия потребител */
  @IsOptional()
  @IsUUID()
  consultantId?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

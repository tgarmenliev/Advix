import { LoanType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeLoanTypeDto {
  @IsEnum(LoanType)
  loanType!: LoanType;
}

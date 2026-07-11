import { LoanStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class TransitionDto {
  @IsEnum(LoanStatus)
  toStatus!: LoanStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

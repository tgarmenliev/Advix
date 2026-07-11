import { ContractType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsValidEGN } from '../../common/validators/is-valid-egn.decorator';

/**
 * "Хлабав" DTO за бързо въвеждане на lead — минимум име.
 * Пълната валидация (egn, netSalary, contractType, gdprConsentAt) се прилага
 * в workflow-а при преход към READY_FOR_BANK, не тук.
 */
export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsValidEGN()
  egn?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Професионален профил
  @IsOptional()
  @IsString()
  employer?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @IsOptional()
  @IsInt()
  @Min(0)
  netSalary?: number; // стотинки

  // Банкови възможности
  @IsOptional()
  @IsBoolean()
  canProvideIncomeProof?: boolean;

  @IsOptional()
  @IsBoolean()
  canTransferSalary?: boolean;

  // Текущи задължения (без рефинансиране)
  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansTotal?: number; // стотинки

  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansMonthlyTotal?: number; // стотинки

  // Семеен профил
  @IsOptional()
  @IsInt()
  @Min(1)
  familySize?: number;

  // GDPR
  @IsOptional()
  @IsDateString()
  gdprConsentAt?: string;
}

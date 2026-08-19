import { ContractType } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsValidEGN } from '../../common/validators/is-valid-egn.decorator';

/**
 * Тясно бяло листо за клиента, който попълва собствените си данни през
 * Secure Link — умишлено БЕЗ gdprConsentAt/gdprDocumentId (отделен, изричен
 * endpoint за съгласие) и БЕЗ никое вътрешно/административно поле.
 */
export class UpdateOwnClientProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

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
  netSalary?: number;

  @IsOptional()
  @IsBoolean()
  canProvideIncomeProof?: boolean;

  @IsOptional()
  @IsBoolean()
  canTransferSalary?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansMonthlyTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  familySize?: number;
}

import { ContractType, RelatedPersonRole } from '@prisma/client';
import {
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
 * Свързано лице (съпруг/а, съжител/ка, съдлъжник) — отварят се абсолютно
 * същите полета като основния клиент, но ЕГН е ЗАДЪЛЖИТЕЛНО с пълна валидация
 * (лицето влиза в заявка към банка, не е lead).
 *
 * clientId идва от URL-а (POST /clients/:clientId/family-members), не от body.
 */
export class CreateFamilyMemberDto {
  @IsEnum(RelatedPersonRole)
  role!: RelatedPersonRole;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsValidEGN()
  egn!: string;

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

  // Текущи задължения (без рефинансиране)
  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansTotal?: number; // стотинки

  @IsOptional()
  @IsInt()
  @Min(0)
  existingLoansMonthlyTotal?: number; // стотинки

  // GDPR — свързаното лице дава собствени лични данни → собствено съгласие
  @IsOptional()
  @IsDateString()
  gdprConsentAt?: string;

  @IsOptional()
  @IsString()
  gdprDocumentId?: string;
}

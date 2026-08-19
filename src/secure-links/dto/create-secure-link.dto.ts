import { SecureLinkPurpose } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Точно едно от clientId/familyMemberId (валидира се в сервиза — class-validator
 * няма native XOR). purpose е само подсказка за имейла, не ограничава действията.
 */
export class CreateSecureLinkDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  familyMemberId?: string;

  @IsOptional()
  @IsEnum(SecureLinkPurpose)
  purpose?: SecureLinkPurpose;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;
}

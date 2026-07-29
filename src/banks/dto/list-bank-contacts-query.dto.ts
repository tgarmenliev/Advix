import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class ListBankContactsQueryDto {
  /** Показва контактите от всички градове (изключва мекия филтър по град) */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  allCities?: boolean;

  /** Изрично избран град (override на града на консултанта по подразбиране) */
  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsUUID()
  bankId?: string;
}

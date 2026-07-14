import { ConstructionType, PropertyType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePropertyDto {
  @IsEnum(PropertyType)
  propertyType!: PropertyType;

  @IsOptional()
  @IsEnum(ConstructionType)
  constructionType?: ConstructionType;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  yearBuilt?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  areaSquareMeters?: number;

  // Местонахождение
  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsString()
  streetNumber?: string;

  // Детайли за сградата (при апартамент)
  @IsOptional()
  @IsInt()
  @Min(0)
  floorNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalFloors?: number;

  @IsOptional()
  @IsString()
  additionalDetails?: string;

  /** Собственици — свободен текст, може повече от един */
  @IsOptional()
  @IsString()
  owners?: string;
}

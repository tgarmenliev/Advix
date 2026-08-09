import { PartnerCommissionModel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ProposePartnerCommissionDto {
  @IsEnum(PartnerCommissionModel)
  model!: PartnerCommissionModel;

  /** При процентните модели: 0.2 = 20% */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  percent?: number;

  /** При фиксирания модел: сума в стотинки */
  @IsOptional()
  @IsInt()
  @Min(0)
  fixed?: number;
}

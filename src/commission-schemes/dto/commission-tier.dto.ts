import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Една скала — по ОБЕМ (minVolume/maxVolume, стотинки) или по БРОЙ сделки
 * (minCount/maxCount), в зависимост от basis на схемата. Само едната двойка
 * се попълва — коя точно се валидира от CommissionSchemesService спрямо
 * schema.basis, не от самия DTO (той не знае контекста на схемата).
 */
export class CommissionTierDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  minVolume?: number;

  /** null / липсва = без горна граница (последната скала) */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVolume?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  percent!: number;
}

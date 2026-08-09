import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Една скала по обем. Сумите са в стотинки, процентът е дроб (0.01 = 1%). */
export class CommissionTierDto {
  @IsInt()
  @Min(0)
  minVolume!: number;

  /** null / липсва = без горна граница (последната скала) */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVolume?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  percent!: number;
}

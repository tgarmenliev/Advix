import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class CreateDisbursementDto {
  /** Усвоена сума на транша (стотинки) */
  @IsInt()
  @Min(1)
  amount!: number;

  /** Дата на усвояване — определя в кой период попада обемът */
  @IsDateString()
  disbursedAt!: string;

  /** По избор — иначе се номерира автоматично като следващ пореден */
  @IsOptional()
  @IsInt()
  @Min(1)
  trancheNumber?: number;
}

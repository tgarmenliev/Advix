import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

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

  /**
   * Кой продукт на банката е тази сделка (трябва да съвпада с label на една
   * от активните схеми). ЗАДЪЛЖИТЕЛНО само когато банката има повече от една
   * активна COMMISSION схема за категорията на заявката към датата на
   * усвояване — иначе не е нужно.
   */
  @IsOptional()
  @IsString()
  commissionLabel?: string;
}

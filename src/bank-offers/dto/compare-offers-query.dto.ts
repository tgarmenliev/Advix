import { IsEnum, IsOptional } from 'class-validator';

/**
 * Критерии за подреждане на сравнението.
 * ВАЖНО: няма подредба по подразбиране — системата не класира офертите.
 * Подреждането е изричен избор на консултанта (виж ComparisonResult.note).
 */
export enum OfferSortBy {
  MONTHLY_PAYMENT = 'monthlyPayment',
  TOTAL_COST = 'totalCost',
  INTEREST_RATE = 'interestRate',
  APR = 'apr',
}

export class CompareOffersQueryDto {
  @IsOptional()
  @IsEnum(OfferSortBy)
  sortBy?: OfferSortBy;
}

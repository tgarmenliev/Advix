import { CommissionLoanCategory, LoanType } from '@prisma/client';

/**
 * Банките разделят комисионите по тип кредит: ипотечен, потребителски и
 * бизнес — трите имат категорично различни цени (бизнес кредитите често имат
 * и собствени подкатегории, вижте CommissionScheme.label).
 */
export function loanTypeToCommissionCategory(
  loanType: LoanType,
): CommissionLoanCategory {
  switch (loanType) {
    case LoanType.MORTGAGE_NO_PURCHASE:
    case LoanType.MORTGAGE_WITH_PURCHASE:
      return CommissionLoanCategory.MORTGAGE;
    case LoanType.CONSUMER:
      return CommissionLoanCategory.CONSUMER;
    case LoanType.BUSINESS:
      return CommissionLoanCategory.BUSINESS;
  }
}

/** Обратното мапване — кои типове заявки влизат в дадена категория. */
export function commissionCategoryToLoanTypes(
  category: CommissionLoanCategory,
): LoanType[] {
  return Object.values(LoanType).filter(
    (loanType) => loanTypeToCommissionCategory(loanType) === category,
  );
}

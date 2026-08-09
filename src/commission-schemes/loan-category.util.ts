import { CommissionLoanCategory, LoanType } from '@prisma/client';

/**
 * Банките правят само едно разделение при комисионите: ипотечен срещу
 * потребителски кредит. Четирите типа заявки се свеждат до тези две категории.
 *
 * Забележка: бизнес кредитът засега се третира като потребителски, защото
 * заданието изрично казва „само това разделение". Ако банките дават различна
 * комисиона за бизнес кредити, тук се добавя трета категория.
 */
export function loanTypeToCommissionCategory(
  loanType: LoanType,
): CommissionLoanCategory {
  switch (loanType) {
    case LoanType.MORTGAGE_NO_PURCHASE:
    case LoanType.MORTGAGE_WITH_PURCHASE:
      return CommissionLoanCategory.MORTGAGE;
    case LoanType.CONSUMER:
    case LoanType.BUSINESS:
      return CommissionLoanCategory.CONSUMER;
  }
}

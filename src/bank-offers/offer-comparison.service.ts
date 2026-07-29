import { Injectable } from '@nestjs/common';
import { BankOffer } from '@prisma/client';
import { OfferSortBy } from './dto/compare-offers-query.dto';

/** Полетата, които влизат в общата цена на кредита (всички в стотинки). */
const COST_COMPONENTS = [
  'totalRepayment',
  'propertyInsurance',
  'lifeInsurance',
  'propertyValuation',
  'preDisburseeFee',
  'mortgageSetupFee',
  'accountMaintenanceFee',
  'creditCardIssueFee',
  'creditCardMaintenanceFee',
] as const satisfies readonly (keyof BankOffer)[];

export interface OfferBreakdown {
  offerId: string;
  bankId: string;
  bankName: string;
  status: string;
  /** Сборът на всички компоненти — изчислен от системата (стотинки) */
  calculatedTotalCost: number;
  /** Каквото банката е обявила като общо плащане (стотинки), ако е попълнено */
  statedTotalPayment: number | null;
  /**
   * statedTotalPayment − calculatedTotalCost. Различно от нула означава, че
   * обявеното от банката не се връзва със сбора на компонентите — сигнал за
   * консултанта да провери, не автоматична преценка.
   */
  discrepancy: number | null;
  monthlyPayment: number | null;
  interestRate: number | null;
  apr: number | null;
  termMonths: number | null;
  /** Кои компоненти липсват — общата цена е непълна, сравнявай внимателно */
  missingComponents: string[];
}

export interface ComparisonResult {
  offers: OfferBreakdown[];
  sortedBy: OfferSortBy | null;
  note: string;
}

const NO_RECOMMENDATION_NOTE =
  'Числата са изчислени от въведените параметри. Системата не класира и не ' +
  'препоръчва оферти — преценката е на консултанта и клиента.';

/**
 * Чист калкулационен слой за сравнение на оферти — само аритметика, без
 * странични ефекти и без достъп до базата.
 *
 * ВАЖНО (MASTER_CONTEXT, забрана №1): този слой НЕ препоръчва оферта и НЕ я
 * класира по подразбиране. Подреждане се прилага само ако консултантът изрично
 * го поиска, и никоя оферта не се маркира като „най-добра".
 */
@Injectable()
export class OfferComparisonService {
  /** Сборът на всички ценови компоненти; липсващите се броят като 0. */
  calculateTotalCost(offer: BankOffer): number {
    return COST_COMPONENTS.reduce(
      (sum, field) => sum + ((offer[field] as number | null) ?? 0),
      0,
    );
  }

  /** Кои ценови компоненти не са попълнени (общата цена е непълна). */
  missingComponents(offer: BankOffer): string[] {
    return COST_COMPONENTS.filter(
      (field) => (offer[field] as number | null) == null,
    );
  }

  breakdown(offer: BankOffer & { bank: { name: string } }): OfferBreakdown {
    const calculatedTotalCost = this.calculateTotalCost(offer);
    const statedTotalPayment = offer.totalPayment ?? null;
    return {
      offerId: offer.id,
      bankId: offer.bankId,
      bankName: offer.bank.name,
      status: offer.status,
      calculatedTotalCost,
      statedTotalPayment,
      discrepancy:
        statedTotalPayment === null
          ? null
          : statedTotalPayment - calculatedTotalCost,
      monthlyPayment: offer.monthlyPayment,
      interestRate: offer.interestRate,
      apr: offer.apr,
      termMonths: offer.termMonths,
      missingComponents: this.missingComponents(offer),
    };
  }

  compare(
    offers: Array<BankOffer & { bank: { name: string } }>,
    sortBy?: OfferSortBy,
  ): ComparisonResult {
    const rows = offers.map((offer) => this.breakdown(offer));

    if (sortBy) {
      // Изрично поискана подредба; липсващите стойности отиват най-отзад,
      // за да не изглеждат като „най-изгодни"
      rows.sort((a, b) => {
        const left = this.sortValue(a, sortBy);
        const right = this.sortValue(b, sortBy);
        if (left === null) return 1;
        if (right === null) return -1;
        return left - right;
      });
    }

    return {
      offers: rows,
      sortedBy: sortBy ?? null,
      note: NO_RECOMMENDATION_NOTE,
    };
  }

  private sortValue(row: OfferBreakdown, sortBy: OfferSortBy): number | null {
    switch (sortBy) {
      case OfferSortBy.MONTHLY_PAYMENT:
        return row.monthlyPayment;
      case OfferSortBy.TOTAL_COST:
        return row.calculatedTotalCost;
      case OfferSortBy.INTEREST_RATE:
        return row.interestRate;
      case OfferSortBy.APR:
        return row.apr;
    }
  }
}

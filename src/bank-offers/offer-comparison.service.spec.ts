import { BankOffer, OfferStatus } from '@prisma/client';
import { OfferSortBy } from './dto/compare-offers-query.dto';
import { OfferComparisonService } from './offer-comparison.service';

type OfferRow = BankOffer & { bank: { name: string } };

/** Оферта с попълнени само подадените полета; останалите са null. */
const makeOffer = (overrides: Partial<OfferRow> & { id: string }): OfferRow =>
  ({
    createdAt: new Date(),
    updatedAt: new Date(),
    loanApplicationId: 'app-1',
    bankId: 'bank-1',
    inquiryId: null,
    status: OfferStatus.PENDING,
    totalRepayment: null,
    propertyInsurance: null,
    lifeInsurance: null,
    propertyValuation: null,
    preDisburseeFee: null,
    mortgageSetupFee: null,
    accountMaintenanceFee: null,
    creditCardIssueFee: null,
    creditCardMaintenanceFee: null,
    monthlyPayment: null,
    interestRate: null,
    apr: null,
    termMonths: null,
    totalPayment: null,
    additionalConditions: null,
    comments: null,
    bank: { name: 'Тестова банка' },
    ...overrides,
  }) as OfferRow;

describe('OfferComparisonService', () => {
  const service = new OfferComparisonService();

  describe('calculateTotalCost', () => {
    it('сумира всички ценови компоненти (в стотинки)', () => {
      const offer = makeOffer({
        id: 'o1',
        totalRepayment: 30000000, // 300 000.00
        propertyInsurance: 120000, // 1 200.00
        lifeInsurance: 90000,
        propertyValuation: 25000,
        preDisburseeFee: 15000,
        mortgageSetupFee: 40000,
        accountMaintenanceFee: 36000,
        creditCardIssueFee: 2000,
        creditCardMaintenanceFee: 6000,
      });

      // 30000000+120000+90000+25000+15000+40000+36000+2000+6000
      expect(service.calculateTotalCost(offer)).toBe(30334000);
    });

    it('липсващите компоненти се броят като 0, не гърми', () => {
      const offer = makeOffer({ id: 'o1', totalRepayment: 1000 });
      expect(service.calculateTotalCost(offer)).toBe(1000);
    });

    it('изцяло празна оферта → 0', () => {
      expect(service.calculateTotalCost(makeOffer({ id: 'o1' }))).toBe(0);
    });
  });

  describe('breakdown', () => {
    it('изчислява разликата спрямо обявеното от банката', () => {
      const offer = makeOffer({
        id: 'o1',
        totalRepayment: 1000000,
        propertyInsurance: 50000,
        totalPayment: 1100000, // банката твърди 11 000.00
      });

      const row = service.breakdown(offer);

      expect(row.calculatedTotalCost).toBe(1050000);
      expect(row.statedTotalPayment).toBe(1100000);
      // банката е обявила 500.00 повече от сбора на компонентите
      expect(row.discrepancy).toBe(50000);
    });

    it('без обявено общо плащане → discrepancy е null', () => {
      const row = service.breakdown(
        makeOffer({ id: 'o1', totalRepayment: 1000 }),
      );
      expect(row.statedTotalPayment).toBeNull();
      expect(row.discrepancy).toBeNull();
    });

    it('изброява липсващите компоненти (непълна обща цена)', () => {
      const row = service.breakdown(
        makeOffer({ id: 'o1', totalRepayment: 1000, lifeInsurance: 200 }),
      );
      expect(row.missingComponents).toContain('propertyInsurance');
      expect(row.missingComponents).not.toContain('totalRepayment');
      expect(row.missingComponents).not.toContain('lifeInsurance');
    });
  });

  describe('compare — без класиране (MASTER_CONTEXT забрана №1)', () => {
    const offers = [
      makeOffer({ id: 'скъпа', monthlyPayment: 200000, totalRepayment: 5000000 }),
      makeOffer({ id: 'евтина', monthlyPayment: 100000, totalRepayment: 3000000 }),
    ];

    it('без sortBy запазва реда на въвеждане и НЕ подрежда по цена', () => {
      const result = service.compare(offers);

      expect(result.offers.map((o) => o.offerId)).toEqual(['скъпа', 'евтина']);
      expect(result.sortedBy).toBeNull();
    });

    it('никоя оферта не се маркира като най-добра/препоръчана', () => {
      const result = service.compare(offers);

      for (const row of result.offers) {
        expect(row).not.toHaveProperty('recommended');
        expect(row).not.toHaveProperty('isBest');
        expect(row).not.toHaveProperty('rank');
      }
      expect(result.note).toContain('не класира');
    });

    it('подрежда САМО при изрично поискан критерий', () => {
      const result = service.compare(offers, OfferSortBy.MONTHLY_PAYMENT);

      expect(result.offers.map((o) => o.offerId)).toEqual(['евтина', 'скъпа']);
      expect(result.sortedBy).toBe(OfferSortBy.MONTHLY_PAYMENT);
    });

    it('оферти с липсваща стойност отиват най-отзад при подреждане', () => {
      const result = service.compare(
        [
          makeOffer({ id: 'без-вноска' }), // monthlyPayment: null
          makeOffer({ id: 'с-вноска', monthlyPayment: 150000 }),
        ],
        OfferSortBy.MONTHLY_PAYMENT,
      );

      expect(result.offers.map((o) => o.offerId)).toEqual([
        'с-вноска',
        'без-вноска',
      ]);
    });

    it('подрежда по обща цена при поискване', () => {
      const result = service.compare(offers, OfferSortBy.TOTAL_COST);
      expect(result.offers[0].offerId).toBe('евтина');
    });
  });
});

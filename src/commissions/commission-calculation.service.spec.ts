import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionLoanCategory,
  CommissionPeriodType,
  CommissionSchemeType,
} from '@prisma/client';
import { SchemeWithTiers } from '../commission-schemes/commission-schemes.service';
import { periodByIndex } from '../commission-schemes/period.util';
import {
  CommissionCalculationService,
  DisbursementInput,
} from './commission-calculation.service';

/** Скали: 0–100к → 0,8% | 100к–300к → 1,0% | 300к+ → 1,2% (в стотинки) */
const TIERS = [
  { id: 't1', schemeId: 's1', minVolume: 0, maxVolume: 10_000_000, percent: 0.008 },
  {
    id: 't2',
    schemeId: 's1',
    minVolume: 10_000_000,
    maxVolume: 30_000_000,
    percent: 0.01,
  },
  { id: 't3', schemeId: 's1', minVolume: 30_000_000, maxVolume: null, percent: 0.012 },
];

const scheme = (over: Partial<SchemeWithTiers> = {}): SchemeWithTiers =>
  ({
    id: 's1',
    createdAt: new Date(),
    updatedAt: new Date(),
    bankId: 'bank-1',
    schemeType: CommissionSchemeType.COMMISSION,
    loanCategory: CommissionLoanCategory.MORTGAGE,
    validFrom: new Date('2026-01-01'),
    validTo: null,
    basis: CommissionBasis.VOLUME_TIERED,
    flatPercent: null,
    periodType: CommissionPeriodType.QUARTERLY,
    evaluationMode: CommissionEvaluationMode.PROGRESSIVE_RETROACTIVE,
    maxPerDealAmount: null,
    notes: null,
    tiers: TIERS,
    ...over,
  }) as SchemeWithTiers;

const disb = (
  id: string,
  amount: number,
  date: string,
  loanApplicationId = 'app-1',
): DisbursementInput => ({
  id,
  loanApplicationId,
  amount,
  disbursedAt: new Date(date),
});

describe('CommissionCalculationService', () => {
  const service = new CommissionCalculationService();
  const q1 = periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 1);

  describe('resolveTier / effectivePercent', () => {
    it.each([
      [0, 0.008],
      [5_000_000, 0.008],
      [9_999_999, 0.008],
      [10_000_000, 0.01], // точно на границата → следващата скала
      [29_999_999, 0.01],
      [30_000_000, 0.012],
      [99_000_000, 0.012], // над последната граница
    ])('обем %i → процент %f', (volume, expected) => {
      expect(service.effectivePercent(scheme(), volume)).toBe(expected);
    });

    it('при фиксиран процент скалите не се ползват', () => {
      const flat = scheme({
        basis: CommissionBasis.FLAT_PERCENT,
        flatPercent: 0.025,
        tiers: [],
      });
      expect(service.effectivePercent(flat, 99_000_000)).toBe(0.025);
      expect(service.resolveTier(flat, 99_000_000)).toBeNull();
    });
  });

  describe('месечна разбивка — примерът от срещата', () => {
    /**
     * Тримесечие с прогресивно отчитане:
     *   яну 80к → скала 0,8%
     *   фев 70к (натрупано 150к) → скала 1,0% + доплащане за януари
     *   мар 170к (натрупано 320к) → скала 1,2% + доплащане за яну+фев
     */
    const disbursements = [
      disb('d1', 8_000_000, '2026-01-15'),
      disb('d2', 7_000_000, '2026-02-15'),
      disb('d3', 17_000_000, '2026-03-15'),
    ];

    it('януари: 80к × 0,8% = 640, без доплащане', () => {
      const rows = service.buildMonthlyBreakdown(scheme(), q1, disbursements);
      expect(rows[0]).toMatchObject({
        monthLabel: '2026-01',
        monthVolume: 8_000_000,
        cumulativeVolume: 8_000_000,
        percent: 0.008,
        earnedThisMonth: 64_000,
        retroactiveTopUp: 0,
        payableThisMonth: 64_000,
      });
    });

    it('февруари: скок на 1,0% + доплащане 160 за януари', () => {
      const rows = service.buildMonthlyBreakdown(scheme(), q1, disbursements);
      expect(rows[1]).toMatchObject({
        monthLabel: '2026-02',
        cumulativeVolume: 15_000_000,
        percent: 0.01,
        earnedThisMonth: 70_000, // 70к × 1,0%
        retroactiveTopUp: 16_000, // 80к × (1,0% − 0,8%)
        payableThisMonth: 86_000,
        cumulativePayable: 150_000, // 150к × 1,0%
      });
    });

    it('март: скок на 1,2% + доплащане 300 за яну+фев', () => {
      const rows = service.buildMonthlyBreakdown(scheme(), q1, disbursements);
      expect(rows[2]).toMatchObject({
        monthLabel: '2026-03',
        cumulativeVolume: 32_000_000,
        percent: 0.012,
        earnedThisMonth: 204_000, // 170к × 1,2%
        retroactiveTopUp: 30_000, // 150к × (1,2% − 1,0%)
        payableThisMonth: 234_000,
        cumulativePayable: 384_000, // 320к × 1,2%
      });
    });

    it('⭐ двата режима дават ЕДИН И СЪЩ краен резултат', () => {
      const rows = service.buildMonthlyBreakdown(scheme(), q1, disbursements);
      const progressiveTotal = rows.reduce(
        (sum, row) => sum + row.payableThisMonth,
        0,
      );

      const endOfPeriod = service.calculatePeriod(
        scheme({ evaluationMode: CommissionEvaluationMode.END_OF_PERIOD }),
        q1,
        disbursements,
      );

      // 640 + 860 + 2340 = 3840 = 320к × 1,2%
      expect(progressiveTotal).toBe(384_000);
      expect(endOfPeriod.total).toBe(384_000);
      expect(progressiveTotal).toBe(endOfPeriod.total);
    });

    it('месец без усвоявания не носи доплащане', () => {
      const rows = service.buildMonthlyBreakdown(scheme(), q1, [
        disb('d1', 8_000_000, '2026-01-15'),
      ]);
      expect(rows[1]).toMatchObject({
        monthVolume: 0,
        payableThisMonth: 0,
        retroactiveTopUp: 0,
      });
    });

    it('режимът END_OF_PERIOD не връща месечна разбивка', () => {
      const result = service.calculatePeriod(
        scheme({ evaluationMode: CommissionEvaluationMode.END_OF_PERIOD }),
        q1,
        disbursements,
      );
      expect(result.monthlyBreakdown).toEqual([]);
    });
  });

  describe('calculatePeriod — редове по траншове', () => {
    it('прилага процента на достигнатата скала към всеки транш', () => {
      const result = service.calculatePeriod(scheme(), q1, [
        disb('d1', 8_000_000, '2026-01-15'),
        disb('d2', 7_000_000, '2026-02-15'),
      ]);

      // обем 150к → 1,0% за целия обем
      expect(result.appliedPercent).toBe(0.01);
      expect(result.lines.map((l) => l.amount)).toEqual([80_000, 70_000]);
      expect(result.total).toBe(150_000);
    });

    it('празен период → нулев обем и нулева сума', () => {
      const result = service.calculatePeriod(scheme(), q1, []);
      expect(result.volume).toBe(0);
      expect(result.total).toBe(0);
      expect(result.lines).toEqual([]);
    });
  });

  describe('таван на сделка', () => {
    it('отрязва комисионата над тавана', () => {
      const result = service.calculatePeriod(
        scheme({ maxPerDealAmount: 100_000 }), // таван 1 000.00
        q1,
        [disb('d1', 30_000_000, '2026-01-15')], // 300к × 1,2% = 3 600.00
      );

      expect(result.lines[0].grossAmount).toBe(360_000);
      expect(result.lines[0].amount).toBe(100_000);
      expect(result.lines[0].capApplied).toBe(true);
      expect(result.total).toBe(100_000);
    });

    it('таванът е за цялата сделка, не за отделен транш', () => {
      const result = service.calculatePeriod(
        scheme({ maxPerDealAmount: 150_000 }),
        q1,
        [
          disb('d1', 8_000_000, '2026-01-15', 'app-1'), // 80к × 1,2% = 960.00
          disb('d2', 8_000_000, '2026-02-15', 'app-1'), // още 960 → над тавана
        ],
      );

      // общо усвоено 160к → скала 1,0%; d1 = 800.00, d2 отрязан до 700.00
      expect(result.lines[0].amount).toBe(80_000);
      expect(result.lines[1].amount).toBe(70_000);
      expect(result.lines[1].capApplied).toBe(true);
      expect(result.total).toBe(150_000); // точно таванът
    });

    it('таванът е отделен за всяка сделка', () => {
      const result = service.calculatePeriod(
        scheme({ maxPerDealAmount: 50_000 }),
        q1,
        [
          disb('d1', 8_000_000, '2026-01-15', 'app-1'),
          disb('d2', 8_000_000, '2026-02-15', 'app-2'),
        ],
      );
      expect(result.lines.every((l) => l.amount === 50_000)).toBe(true);
      expect(result.total).toBe(100_000); // 2 сделки × таван
    });

    it('отчита вече начислено по сделката от предишен период', () => {
      const result = service.calculatePeriod(
        scheme({ maxPerDealAmount: 100_000 }),
        q1,
        [disb('d2', 8_000_000, '2026-02-15', 'app-1')],
        new Map([['app-1', 90_000]]), // вече начислени 900.00
      );

      expect(result.lines[0].amount).toBe(10_000); // остават само 100.00
      expect(result.lines[0].capApplied).toBe(true);
    });

    it('изчерпан таван → нулева комисиона, без отрицателни суми', () => {
      const result = service.calculatePeriod(
        scheme({ maxPerDealAmount: 100_000 }),
        q1,
        [disb('d3', 8_000_000, '2026-03-15', 'app-1')],
        new Map([['app-1', 120_000]]), // вече над тавана
      );
      expect(result.lines[0].amount).toBe(0);
    });
  });

  describe('закръгляване', () => {
    it('сумите са цели стотинки', () => {
      const result = service.calculatePeriod(
        scheme({ basis: CommissionBasis.FLAT_PERCENT, flatPercent: 0.0333, tiers: [] }),
        q1,
        [disb('d1', 1_000_001, '2026-01-15')],
      );
      expect(Number.isInteger(result.total)).toBe(true);
      expect(result.total).toBe(Math.round(1_000_001 * 0.0333));
    });

    it('месечните суми се сумират точно до общата (без дрейф)', () => {
      const disbursements = [
        disb('d1', 3_333_333, '2026-01-10'),
        disb('d2', 3_333_333, '2026-02-10'),
        disb('d3', 3_333_334, '2026-03-10'),
      ];
      const rows = service.buildMonthlyBreakdown(scheme(), q1, disbursements);
      const sum = rows.reduce((s, r) => s + r.payableThisMonth, 0);
      expect(sum).toBe(rows[rows.length - 1].cumulativePayable);
    });
  });
});

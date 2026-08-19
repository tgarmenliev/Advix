import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionLoanCategory,
  CommissionPeriodType,
  CommissionSchemeType,
  LoanType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CommissionSchemesService } from './commission-schemes.service';
import { CreateCommissionSchemeDto } from './dto/create-commission-scheme.dto';
import { loanTypeToCommissionCategory } from './loan-category.util';

describe('CommissionSchemesService', () => {
  let service: CommissionSchemesService;

  const commissionScheme = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const commissionTier = { deleteMany: jest.fn() };
  const bank = { findUnique: jest.fn() };
  const db = {
    commissionScheme,
    commissionTier,
    bank,
    $transaction: (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };

  /** Валидна базова схема с фиксиран процент. */
  const flatDto = (
    over: Partial<CreateCommissionSchemeDto> = {},
  ): CreateCommissionSchemeDto => ({
    schemeType: CommissionSchemeType.COMMISSION,
    loanCategory: CommissionLoanCategory.MORTGAGE,
    validFrom: '2026-01-01',
    basis: CommissionBasis.FLAT_PERCENT,
    flatPercent: 0.01,
    ...over,
  });

  /** Валидна схема със скали: 0–100k → 0.8%, 100k–300k → 1%, 300k+ → 1.2% */
  const tieredDto = (
    over: Partial<CreateCommissionSchemeDto> = {},
  ): CreateCommissionSchemeDto => ({
    schemeType: CommissionSchemeType.COMMISSION,
    loanCategory: CommissionLoanCategory.MORTGAGE,
    validFrom: '2026-01-01',
    basis: CommissionBasis.VOLUME_TIERED,
    periodType: CommissionPeriodType.QUARTERLY,
    evaluationMode: CommissionEvaluationMode.PROGRESSIVE_RETROACTIVE,
    tiers: [
      { minVolume: 0, maxVolume: 10000000, percent: 0.008 },
      { minVolume: 10000000, maxVolume: 30000000, percent: 0.01 },
      { minVolume: 30000000, percent: 0.012 },
    ],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    bank.findUnique.mockResolvedValue({ id: 'bank-1' });
    commissionScheme.findFirst.mockResolvedValue(null); // няма застъпване
    commissionScheme.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'scheme-1', ...data, tiers: [] }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionSchemesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(CommissionSchemesService);
  });

  describe('create — валидна конфигурация', () => {
    it('приема фиксиран процент', async () => {
      await service.create('bank-1', flatDto());
      expect(commissionScheme.create).toHaveBeenCalled();
    });

    it('приема скали по обем и ги записва', async () => {
      await service.create('bank-1', tieredDto());
      const data = (
        commissionScheme.create.mock.calls[0][0] as {
          data: { tiers: { create: unknown[] } };
        }
      ).data;
      expect(data.tiers.create).toHaveLength(3);
    });

    it('несъществуваща банка → NotFound', async () => {
      bank.findUnique.mockResolvedValue(null);
      await expect(service.create('няма', flatDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('валидация на формата', () => {
    it('FLAT_PERCENT без процент → 400', async () => {
      await expect(
        service.create('bank-1', flatDto({ flatPercent: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('FLAT_PERCENT със скали → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          flatDto({ tiers: [{ minVolume: 0, percent: 0.01 }] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('VOLUME_TIERED без период → 400', async () => {
      await expect(
        service.create('bank-1', tieredDto({ periodType: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('VOLUME_TIERED без режим на отчитане → 400', async () => {
      await expect(
        service.create('bank-1', tieredDto({ evaluationMode: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('VOLUME_TIERED без скали → 400', async () => {
      await expect(
        service.create('bank-1', tieredDto({ tiers: [] })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('валидация на скалите', () => {
    it('първата скала трябва да започва от 0', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 5000, maxVolume: 10000000, percent: 0.008 },
              { minVolume: 10000000, percent: 0.01 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('дупка между скалите → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 0, maxVolume: 10000000, percent: 0.008 },
              { minVolume: 20000000, percent: 0.01 }, // дупка 10M–20M
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('застъпващи се скали → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 0, maxVolume: 15000000, percent: 0.008 },
              { minVolume: 10000000, percent: 0.01 }, // започва преди края
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('последната скала трябва да е без горна граница', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 0, maxVolume: 10000000, percent: 0.008 },
              { minVolume: 10000000, maxVolume: 30000000, percent: 0.01 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('само последната може да е без горна граница', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 0, percent: 0.008 }, // отворена, но не е последна
              { minVolume: 10000000, percent: 0.01 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maxVolume <= minVolume → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 0, maxVolume: 0, percent: 0.008 },
              { minVolume: 0, percent: 0.01 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('приема скали, подадени в разбъркан ред', async () => {
      await expect(
        service.create(
          'bank-1',
          tieredDto({
            tiers: [
              { minVolume: 30000000, percent: 0.012 },
              { minVolume: 0, maxVolume: 10000000, percent: 0.008 },
              { minVolume: 10000000, maxVolume: 30000000, percent: 0.01 },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('валидност във времето', () => {
    it('validTo преди validFrom → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          flatDto({ validFrom: '2026-06-01', validTo: '2026-01-01' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('застъпване с друга схема за същия ключ → 409', async () => {
      commissionScheme.findFirst.mockResolvedValue({
        id: 'друга',
        validFrom: new Date('2025-01-01'),
      });
      await expect(
        service.create('bank-1', flatDto()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('проверката за застъпване е по банка + вид + категория', async () => {
      await service.create('bank-1', flatDto());
      expect(commissionScheme.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bankId: 'bank-1',
            schemeType: CommissionSchemeType.COMMISSION,
            loanCategory: CommissionLoanCategory.MORTGAGE,
          }),
        }),
      );
    });
  });

  describe('resolveActive', () => {
    it('търси схема, действаща към подадената дата', async () => {
      commissionScheme.findFirst.mockResolvedValue({ id: 'scheme-1', tiers: [] });
      const at = new Date('2026-08-09');

      await service.resolveActive(
        'bank-1',
        CommissionSchemeType.BONUS,
        CommissionLoanCategory.CONSUMER,
        at,
      );

      expect(commissionScheme.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bankId: 'bank-1',
            schemeType: CommissionSchemeType.BONUS,
            loanCategory: CommissionLoanCategory.CONSUMER,
            validFrom: { lte: at },
            OR: [{ validTo: null }, { validTo: { gt: at } }],
          }),
        }),
      );
    });

    it('липсваща схема → null (не е грешка)', async () => {
      commissionScheme.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveActive(
          'bank-1',
          CommissionSchemeType.COMMISSION,
          CommissionLoanCategory.MORTGAGE,
        ),
      ).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('заменя скалите изцяло', async () => {
      commissionScheme.findUnique.mockResolvedValue({
        id: 'scheme-1',
        bankId: 'bank-1',
        schemeType: CommissionSchemeType.COMMISSION,
        loanCategory: CommissionLoanCategory.MORTGAGE,
        basis: CommissionBasis.VOLUME_TIERED,
        periodType: CommissionPeriodType.QUARTERLY,
        evaluationMode: CommissionEvaluationMode.END_OF_PERIOD,
        validFrom: new Date('2026-01-01'),
        validTo: null,
        flatPercent: null,
        tiers: [],
      });
      commissionScheme.update.mockResolvedValue({ id: 'scheme-1', tiers: [] });

      await service.update('scheme-1', {
        tiers: [
          { minVolume: 0, maxVolume: 5000000, percent: 0.007 },
          { minVolume: 5000000, percent: 0.009 },
        ],
      });

      expect(commissionTier.deleteMany).toHaveBeenCalledWith({
        where: { schemeId: 'scheme-1' },
      });
    });

    it('частична редакция не бива да оставя невалидна схема', async () => {
      commissionScheme.findUnique.mockResolvedValue({
        id: 'scheme-1',
        bankId: 'bank-1',
        schemeType: CommissionSchemeType.COMMISSION,
        loanCategory: CommissionLoanCategory.MORTGAGE,
        basis: CommissionBasis.FLAT_PERCENT,
        flatPercent: 0.01,
        periodType: null,
        evaluationMode: null,
        validFrom: new Date('2026-01-01'),
        validTo: null,
        tiers: [],
      });

      // Смяна към скали, но без период/режим/скали → трябва да гръмне
      await expect(
        service.update('scheme-1', { basis: CommissionBasis.VOLUME_TIERED }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * COUNT_TIERED — реалният случай на бизнес кредити с тиериране по БРОЙ
   * сделки за периода (напр. "0,6% при 2 бр./тримесечие, 1% при 3+ бр.").
   * Валидацията на скалите е идентична на VOLUME_TIERED, само по count полета.
   */
  describe('COUNT_TIERED схеми', () => {
    const countTieredDto = (
      over: Partial<CreateCommissionSchemeDto> = {},
    ): CreateCommissionSchemeDto => ({
      schemeType: CommissionSchemeType.COMMISSION,
      loanCategory: CommissionLoanCategory.BUSINESS,
      validFrom: '2026-01-01',
      basis: CommissionBasis.COUNT_TIERED,
      periodType: CommissionPeriodType.QUARTERLY,
      evaluationMode: CommissionEvaluationMode.END_OF_PERIOD,
      label: 'Оборотни средства',
      tiers: [
        { minCount: 0, maxCount: 3, percent: 0.006 },
        { minCount: 3, percent: 0.01 },
      ],
      ...over,
    });

    it('приема валидни скали по брой', async () => {
      await expect(
        service.create('bank-1', countTieredDto()),
      ).resolves.toBeDefined();
    });

    it('дупка между count скалите → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          countTieredDto({
            tiers: [
              { minCount: 0, maxCount: 2, percent: 0.006 },
              { minCount: 5, percent: 0.01 }, // дупка 2–5
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('първата count скала трябва да започва от 0', async () => {
      await expect(
        service.create(
          'bank-1',
          countTieredDto({
            tiers: [
              { minCount: 1, maxCount: 3, percent: 0.006 },
              { minCount: 3, percent: 0.01 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('без периоден тип/режим на отчитане → 400 (както при VOLUME_TIERED)', async () => {
      await expect(
        service.create('bank-1', countTieredDto({ periodType: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * Label: две схеми за същата банка+вид+категория, но различни продукти
   * (бизнес подкатегории) — не трябва да се броят за застъпване.
   */
  describe('label и застъпване на валидност', () => {
    it('различни label-и за същия ключ МОГАТ да съществуват едновременно', async () => {
      // Първата схема ("Кредитна линия") вече покрива периода
      commissionScheme.findFirst.mockImplementation(
        ({ where }: { where: { label?: string | null } }) =>
          Promise.resolve(where.label === 'Кредитна линия' ? { id: 'existing', validFrom: new Date('2026-01-01') } : null),
      );

      await expect(
        service.create(
          'bank-1',
          flatDto({
            loanCategory: CommissionLoanCategory.BUSINESS,
            label: 'Инсталментни кредити', // друг продукт — не влиза в конфликт
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('два реда за СЪЩИЯ label и застъпваща валидност → 409', async () => {
      commissionScheme.findFirst.mockResolvedValue({
        id: 'existing',
        validFrom: new Date('2026-01-01'),
      });

      await expect(
        service.create(
          'bank-1',
          flatDto({
            loanCategory: CommissionLoanCategory.BUSINESS,
            label: 'Инсталментни кредити',
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('overlap проверката филтрира изрично по label в заявката към базата', async () => {
      await service.create(
        'bank-1',
        flatDto({ loanCategory: CommissionLoanCategory.BUSINESS, label: 'Линии' }),
      );
      expect(commissionScheme.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ label: 'Линии' }),
        }),
      );
    });
  });

  describe('findActiveSchemes', () => {
    it('връща всички активни схеми (за консултанта да избере при повече от една)', async () => {
      commissionScheme.findMany.mockResolvedValue([
        { id: 's1', label: 'Линии' },
        { id: 's2', label: 'Инсталменти' },
      ]);

      const result = await service.findActiveSchemes(
        'bank-1',
        CommissionSchemeType.COMMISSION,
        CommissionLoanCategory.BUSINESS,
        new Date('2026-06-01'),
      );

      expect(result).toHaveLength(2);
      expect(commissionScheme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bankId: 'bank-1',
            schemeType: CommissionSchemeType.COMMISSION,
            loanCategory: CommissionLoanCategory.BUSINESS,
          }),
        }),
      );
    });
  });
});

describe('loanTypeToCommissionCategory', () => {
  it('двата ипотечни типа → MORTGAGE', () => {
    expect(loanTypeToCommissionCategory(LoanType.MORTGAGE_WITH_PURCHASE)).toBe(
      CommissionLoanCategory.MORTGAGE,
    );
    expect(loanTypeToCommissionCategory(LoanType.MORTGAGE_NO_PURCHASE)).toBe(
      CommissionLoanCategory.MORTGAGE,
    );
  });

  it('потребителски → CONSUMER, бизнес → собствена категория BUSINESS', () => {
    expect(loanTypeToCommissionCategory(LoanType.CONSUMER)).toBe(
      CommissionLoanCategory.CONSUMER,
    );
    expect(loanTypeToCommissionCategory(LoanType.BUSINESS)).toBe(
      CommissionLoanCategory.BUSINESS,
    );
  });
});

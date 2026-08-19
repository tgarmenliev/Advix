import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CommissionAdjustmentType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { CommissionAdjustmentsService } from './commission-adjustments.service';

describe('CommissionAdjustmentsService', () => {
  let service: CommissionAdjustmentsService;

  const commissionAdjustment = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  };
  const bank = { findUnique: jest.fn() };
  const loanApplication = { findUnique: jest.fn() };
  const bankPeriodBonus = { findUnique: jest.fn() };
  const db = { commissionAdjustment, bank, loanApplication, bankPeriodBonus };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };

  const admin: AuthenticatedUser = {
    userId: 'admin-1',
    tenantId: 'tenant-1',
    email: 'a@test.bg',
    role: UserRole.ADMIN,
  };

  const baseDto = {
    type: CommissionAdjustmentType.CLAWBACK,
    amount: -50_000,
    reason: 'Клиентът погаси предсрочно',
    occurredAt: '2026-08-01',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    bank.findUnique.mockResolvedValue({ id: 'bank-1' });
    commissionAdjustment.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'adj-1', ...data }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionAdjustmentsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(CommissionAdjustmentsService);
  });

  describe('create — знакът на сумата пази смисъла', () => {
    it('записва clawback с отрицателна сума', async () => {
      const result = await service.create('bank-1', baseDto, admin);
      expect(result.amount).toBe(-50_000);
      expect(commissionAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bankId: 'bank-1',
          type: CommissionAdjustmentType.CLAWBACK,
          createdByUserId: 'admin-1',
        }),
      });
    });

    it('clawback с положителна сума → 400', async () => {
      await expect(
        service.create('bank-1', { ...baseDto, amount: 50_000 }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('доплащане с отрицателна сума → 400', async () => {
      await expect(
        service.create(
          'bank-1',
          {
            ...baseDto,
            type: CommissionAdjustmentType.MANUAL_TOP_UP,
            amount: -1000,
          },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('нулева сума → 400', async () => {
      await expect(
        service.create('bank-1', { ...baseDto, amount: 0 }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('корекцията може да е в двете посоки', async () => {
      await expect(
        service.create(
          'bank-1',
          {
            ...baseDto,
            type: CommissionAdjustmentType.CORRECTION,
            amount: -1234,
          },
          admin,
        ),
      ).resolves.toBeDefined();
      await expect(
        service.create(
          'bank-1',
          {
            ...baseDto,
            type: CommissionAdjustmentType.CORRECTION,
            amount: 1234,
          },
          admin,
        ),
      ).resolves.toBeDefined();
    });

    it('несъществуваща банка → 404', async () => {
      bank.findUnique.mockResolvedValue(null);
      await expect(
        service.create('няма', baseDto, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('корекция по несъществуваща сделка → 400', async () => {
      loanApplication.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          'bank-1',
          { ...baseDto, loanApplicationId: 'няма-такава' },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * Случаят "импостер банка": clawback по получен ПЕРИОДЕН БОНУС, не по
   * конкретна сделка (напр. банка, връщаща тримесечния бонус при предсрочно
   * погасяване в 1-та година).
   */
  describe('create — clawback по bankPeriodBonusId', () => {
    it('приема корекция, свързана с периоден бонус', async () => {
      bankPeriodBonus.findUnique.mockResolvedValue({
        id: 'bonus-1',
        bankId: 'bank-1',
      });

      const result = await service.create(
        'bank-1',
        { ...baseDto, bankPeriodBonusId: 'bonus-1' },
        admin,
      );

      expect(commissionAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ bankPeriodBonusId: 'bonus-1' }),
      });
      expect(result.bankPeriodBonusId).toBe('bonus-1');
    });

    it('несъществуващ бонус → 400', async () => {
      bankPeriodBonus.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          'bank-1',
          { ...baseDto, bankPeriodBonusId: 'няма-такъв' },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('бонус на друга банка → 400', async () => {
      bankPeriodBonus.findUnique.mockResolvedValue({
        id: 'bonus-1',
        bankId: 'ДРУГА-банка',
      });
      await expect(
        service.create(
          'bank-1',
          { ...baseDto, bankPeriodBonusId: 'bonus-1' },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('settle', () => {
    it('отбелязва корекцията като приспадната', async () => {
      commissionAdjustment.findUnique.mockResolvedValue({
        id: 'adj-1',
        settledAt: null,
      });
      commissionAdjustment.update.mockResolvedValue({ id: 'adj-1' });

      await service.settle('adj-1');

      const data = (
        commissionAdjustment.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.settledAt).toBeInstanceOf(Date);
    });

    it('вече уредена → 400', async () => {
      commissionAdjustment.findUnique.mockResolvedValue({
        id: 'adj-1',
        settledAt: new Date(),
      });
      await expect(service.settle('adj-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('outstandingBalance', () => {
    it('сумира само неуредените корекции', async () => {
      commissionAdjustment.aggregate.mockResolvedValue({
        _sum: { amount: -75_000 },
      });

      const balance = await service.outstandingBalance('bank-1');

      expect(balance).toBe(-75_000);
      expect(commissionAdjustment.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: { bankId: 'bank-1', settledAt: null },
      });
    });

    it('без корекции → 0', async () => {
      commissionAdjustment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      await expect(service.outstandingBalance('bank-1')).resolves.toBe(0);
    });
  });
});

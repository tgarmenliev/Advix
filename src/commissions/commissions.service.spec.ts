import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionLoanCategory,
  CommissionPeriodType,
  CommissionSchemeType,
  CommissionStatus,
} from '@prisma/client';
import { CommissionSchemesService } from '../commission-schemes/commission-schemes.service';
import { PrismaService } from '../database/prisma.service';
import { DisbursementsService } from '../disbursements/disbursements.service';
import { CommissionCalculationService } from './commission-calculation.service';
import { CommissionsService } from './commissions.service';

describe('CommissionsService', () => {
  let service: CommissionsService;

  const trancheCommission = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const commissionRecord = { findUnique: jest.fn(), create: jest.fn() };
  const bankPeriodBonus = { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() };
  const db = { trancheCommission, commissionRecord, bankPeriodBonus };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };
  const schemesMock = { resolveActive: jest.fn() };
  const disbursementsMock = { findForPeriod: jest.fn() };

  const tieredScheme = {
    id: 'scheme-1',
    basis: CommissionBasis.VOLUME_TIERED,
    periodType: CommissionPeriodType.QUARTERLY,
    evaluationMode: CommissionEvaluationMode.PROGRESSIVE_RETROACTIVE,
    flatPercent: null,
    maxPerDealAmount: null,
    tiers: [
      { id: 't1', schemeId: 'scheme-1', minVolume: 0, maxVolume: 10_000_000, percent: 0.008 },
      { id: 't2', schemeId: 'scheme-1', minVolume: 10_000_000, maxVolume: null, percent: 0.01 },
    ],
  };

  const disbursementRow = (
    id: string,
    amount: number,
    date: string,
    loanApplicationId = 'app-1',
  ) => ({
    id,
    amount,
    disbursedAt: new Date(date),
    offer: { id: 'offer-1', bankId: 'bank-1', loanApplicationId },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    schemesMock.resolveActive.mockResolvedValue(tieredScheme);
    disbursementsMock.findForPeriod.mockResolvedValue([]);
    trancheCommission.findMany.mockResolvedValue([]);
    commissionRecord.findUnique.mockResolvedValue({ id: 'rec-1' });
    trancheCommission.upsert.mockResolvedValue({});
    bankPeriodBonus.upsert.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionsService,
        CommissionCalculationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CommissionSchemesService, useValue: schemesMock },
        { provide: DisbursementsService, useValue: disbursementsMock },
      ],
    }).compile();
    service = moduleRef.get(CommissionsService);
  });

  describe('recalculate — комисиони', () => {
    it('записва комисиона за всеки транш по достигнатата скала', async () => {
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d1', 8_000_000, '2026-01-15'),
        disbursementRow('d2', 7_000_000, '2026-02-15'),
      ]);

      const result = await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.COMMISSION,
        new Date('2026-02-20'),
      );

      // обем 150к → скала 1,0%
      expect(result.appliedPercent).toBe(0.01);
      expect(result.total).toBe(150_000);
      expect(result.affected).toBe(2);
      expect(result.period.label).toBe('2026-Q1');
      expect(trancheCommission.upsert).toHaveBeenCalledTimes(2);
    });

    it('преизчисляването НЕ нулира вече отбелязаното плащане', async () => {
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d1', 8_000_000, '2026-01-15'),
      ]);

      await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.COMMISSION,
        new Date('2026-02-20'),
      );

      const call = trancheCommission.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      };
      // при обновяване се пипа само очакваната сума
      expect(call.update).not.toHaveProperty('status');
      expect(call.update).not.toHaveProperty('actualAmount');
      expect(call.create).toMatchObject({ status: CommissionStatus.EXPECTED });
    });

    it('връща месечната разбивка при прогресивен режим', async () => {
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d1', 8_000_000, '2026-01-15'),
        disbursementRow('d2', 7_000_000, '2026-02-15'),
      ]);

      const result = await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.COMMISSION,
        new Date('2026-02-20'),
      );

      expect(result.monthlyBreakdown).toHaveLength(3); // 3 месеца в тримесечието
      expect(result.monthlyBreakdown[1].retroactiveTopUp).toBe(16_000);
    });

    it('създава запис за комисиони по заявката, ако още няма', async () => {
      commissionRecord.findUnique.mockResolvedValue(null);
      commissionRecord.create.mockResolvedValue({ id: 'rec-new' });
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d1', 8_000_000, '2026-01-15'),
      ]);

      await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.COMMISSION,
        new Date('2026-01-20'),
      );

      expect(commissionRecord.create).toHaveBeenCalledWith({
        data: { loanApplicationId: 'app-1' },
      });
    });

    it('отчита вече начисленото от предишни периоди за тавана', async () => {
      trancheCommission.findMany.mockResolvedValue([
        {
          expectedAmount: 90_000,
          commissionRecord: { loanApplicationId: 'app-1' },
        },
      ]);
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d2', 8_000_000, '2026-04-15'),
      ]);
      schemesMock.resolveActive.mockResolvedValue({
        ...tieredScheme,
        maxPerDealAmount: 100_000,
      });

      const result = await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.COMMISSION,
        new Date('2026-04-20'),
      );

      // остават само 100.00 до тавана
      expect(result.total).toBe(10_000);
    });

    it('липсваща активна схема → 400', async () => {
      schemesMock.resolveActive.mockResolvedValue(null);

      await expect(
        service.recalculate(
          'bank-1',
          CommissionLoanCategory.MORTGAGE,
          CommissionSchemeType.COMMISSION,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('recalculate — бонус', () => {
    it('записва бонуса на ниво период, не на транш', async () => {
      schemesMock.resolveActive.mockResolvedValue({
        ...tieredScheme,
        schemeType: CommissionSchemeType.BONUS,
        evaluationMode: CommissionEvaluationMode.END_OF_PERIOD,
      });
      disbursementsMock.findForPeriod.mockResolvedValue([
        disbursementRow('d1', 20_000_000, '2026-01-15'),
      ]);

      const result = await service.recalculate(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        CommissionSchemeType.BONUS,
        new Date('2026-02-20'),
      );

      expect(bankPeriodBonus.upsert).toHaveBeenCalled();
      expect(trancheCommission.upsert).not.toHaveBeenCalled();
      expect(result.affected).toBe(1);
      expect(result.total).toBe(200_000); // 200к × 1,0%
    });
  });

  describe('updateTrancheStatus', () => {
    it('отбелязва получена комисиона и попълва датата', async () => {
      trancheCommission.findUnique.mockResolvedValue({
        id: 'tc-1',
        occurredAt: null,
      });
      trancheCommission.update.mockResolvedValue({ id: 'tc-1' });

      await service.updateTrancheStatus('tc-1', CommissionStatus.RECEIVED, 95_000);

      const data = (
        trancheCommission.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.status).toBe(CommissionStatus.RECEIVED);
      expect(data.actualAmount).toBe(95_000);
      expect(data.occurredAt).toBeInstanceOf(Date);
    });

    it('несъществуваща комисиона → 404', async () => {
      trancheCommission.findUnique.mockResolvedValue(null);
      await expect(
        service.updateTrancheStatus('няма', CommissionStatus.ACCRUED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

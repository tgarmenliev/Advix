import { Test } from '@nestjs/testing';
import {
  CommissionPeriodType,
  CommissionStatus,
  PartnerCommissionStatus,
} from '@prisma/client';
import { periodByIndex } from '../commission-schemes/period.util';
import { PrismaService } from '../database/prisma.service';
import { CommissionAdjustmentsService } from './commission-adjustments.service';
import { CommissionReportsService } from './commission-reports.service';

describe('CommissionReportsService', () => {
  let service: CommissionReportsService;

  const bank = { findMany: jest.fn(), findUnique: jest.fn() };
  const trancheCommission = { findMany: jest.fn() };
  const bankPeriodBonus = { findMany: jest.fn() };
  const commissionRecord = { findMany: jest.fn() };
  const db = { bank, trancheCommission, bankPeriodBonus, commissionRecord };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };
  const adjustmentsMock = { outstandingBalance: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    bank.findMany.mockResolvedValue([{ id: 'bank-1', name: 'ДСК' }]);
    trancheCommission.findMany.mockResolvedValue([]);
    bankPeriodBonus.findMany.mockResolvedValue([]);
    commissionRecord.findMany.mockResolvedValue([]);
    adjustmentsMock.outstandingBalance.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionReportsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CommissionAdjustmentsService, useValue: adjustmentsMock },
      ],
    }).compile();
    service = moduleRef.get(CommissionReportsService);
  });

  describe('bankSummary', () => {
    it('разделя очаквано, начислено и получено', async () => {
      trancheCommission.findMany.mockResolvedValue([
        {
          expectedAmount: 100_000,
          actualAmount: 95_000,
          status: CommissionStatus.RECEIVED,
        },
        {
          expectedAmount: 80_000,
          actualAmount: null,
          status: CommissionStatus.ACCRUED,
        },
        {
          expectedAmount: 50_000,
          actualAmount: null,
          status: CommissionStatus.EXPECTED,
        },
      ]);

      const summary = await service.bankSummary('bank-1', 'ДСК');

      expect(summary.commissions.expected).toBe(230_000);
      // начисленото включва и полученото; при липса на реална сума се ползва очакваната
      expect(summary.commissions.accrued).toBe(175_000); // 95 000 + 80 000
      expect(summary.commissions.received).toBe(95_000);
      expect(summary.outstanding).toBe(135_000); // 230 000 − 95 000
    });

    it('неуреден clawback намалява нетно полученото', async () => {
      trancheCommission.findMany.mockResolvedValue([
        {
          expectedAmount: 100_000,
          actualAmount: 100_000,
          status: CommissionStatus.RECEIVED,
        },
      ]);
      adjustmentsMock.outstandingBalance.mockResolvedValue(-30_000);

      const summary = await service.bankSummary('bank-1', 'ДСК');

      expect(summary.commissions.received).toBe(100_000);
      expect(summary.outstandingAdjustments).toBe(-30_000);
      expect(summary.netReceived).toBe(70_000);
    });

    it('бонусите се броят отделно от комисионите', async () => {
      bankPeriodBonus.findMany.mockResolvedValue([
        {
          expectedAmount: 40_000,
          actualAmount: 40_000,
          status: CommissionStatus.RECEIVED,
        },
      ]);

      const summary = await service.bankSummary('bank-1', 'ДСК');

      expect(summary.bonuses.received).toBe(40_000);
      expect(summary.commissions.received).toBe(0);
      expect(summary.netReceived).toBe(40_000);
    });
  });

  describe('portfolio', () => {
    it('нетният приход е полученото минус изплатеното на партньори', async () => {
      trancheCommission.findMany.mockResolvedValue([
        {
          expectedAmount: 200_000,
          actualAmount: 200_000,
          status: CommissionStatus.RECEIVED,
        },
      ]);
      commissionRecord.findMany.mockResolvedValue([
        {
          partnerCommissionAmount: 40_000,
          partnerCommissionStatus: PartnerCommissionStatus.PAID,
        },
      ]);

      const report = await service.portfolio();

      expect(report.totals.received).toBe(200_000);
      expect(report.totals.partnerPaid).toBe(40_000);
      expect(report.totals.netRevenue).toBe(160_000);
    });

    it('банки без движение не се показват', async () => {
      bank.findMany.mockResolvedValue([
        { id: 'bank-1', name: 'ДСК' },
        { id: 'bank-2', name: 'Без движение' },
      ]);

      const report = await service.portfolio();

      expect(report.banks).toHaveLength(0); // и двете са без данни
    });

    it('ограничава по календарен период', async () => {
      const period = periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 1);

      await service.portfolio(period);

      const where = (
        trancheCommission.findMany.mock.calls[0][0] as {
          where: { disbursement: { disbursedAt: unknown } };
        }
      ).where;
      expect(where.disbursement.disbursedAt).toEqual({
        gte: period.startsAt,
        lt: period.endsAt,
      });
    });
  });

  describe('byPartner', () => {
    it('групира дължимото и платеното по партньор', async () => {
      commissionRecord.findMany.mockResolvedValue([
        {
          partnerId: 'p1',
          loanApplicationId: 'a1',
          partnerCommissionAmount: 40_000,
          partnerCommissionStatus: PartnerCommissionStatus.PAID,
        },
        {
          partnerId: 'p1',
          loanApplicationId: 'a2',
          partnerCommissionAmount: 30_000,
          partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        },
        {
          partnerId: 'p2',
          loanApplicationId: 'a3',
          partnerCommissionAmount: 10_000,
          partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        },
      ]);

      const rows = await service.byPartner();

      expect(rows).toEqual([
        { partnerId: 'p1', deals: 2, approved: 30_000, paid: 40_000 },
        { partnerId: 'p2', deals: 1, approved: 10_000, paid: 0 },
      ]);
    });
  });
});

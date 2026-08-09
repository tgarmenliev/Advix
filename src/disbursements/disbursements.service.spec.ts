import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommissionLoanCategory,
  CommissionPeriodType,
  LoanStatus,
  LoanType,
  OfferStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { periodByIndex } from '../commission-schemes/period.util';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { DisbursementsService } from './disbursements.service';

describe('DisbursementsService', () => {
  let service: DisbursementsService;

  const disbursement = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
  };
  const bankOffer = { findFirst: jest.fn() };
  const loanApplication = { findUnique: jest.fn() };
  const trancheCommission = { findUnique: jest.fn() };
  const db = { disbursement, bankOffer, loanApplication, trancheCommission };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };
  const loanAppsMock = { assertAccessById: jest.fn() };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };

  const approvedApp = {
    id: 'app-1',
    status: LoanStatus.APPROVED,
    amount: 20000000, // 200 000.00
    loanType: LoanType.MORTGAGE_WITH_PURCHASE,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    loanAppsMock.assertAccessById.mockResolvedValue(undefined);
    loanApplication.findUnique.mockResolvedValue(approvedApp);
    bankOffer.findFirst.mockResolvedValue({
      id: 'offer-1',
      status: OfferStatus.APPROVED,
    });
    disbursement.findMany.mockResolvedValue([]);
    disbursement.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'disb-1', ...data }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisbursementsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LoanApplicationsService, useValue: loanAppsMock },
      ],
    }).compile();
    service = moduleRef.get(DisbursementsService);
  });

  describe('create', () => {
    it('записва транш и го номерира като първи', async () => {
      const result = await service.create(
        'app-1',
        { amount: 10000000, disbursedAt: '2026-02-10' },
        consultant,
      );

      expect(disbursement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          offerId: 'offer-1',
          trancheNumber: 1,
          amount: 10000000,
        }),
      });
      expect(result.totalDisbursed).toBe(10000000);
      expect(result.warning).toBeUndefined();
    });

    it('номерира следващия транш автоматично', async () => {
      disbursement.findMany.mockResolvedValue([
        { trancheNumber: 1, amount: 8000000 },
        { trancheNumber: 2, amount: 4000000 },
      ]);

      const result = await service.create(
        'app-1',
        { amount: 3000000, disbursedAt: '2026-05-10' },
        consultant,
      );

      expect(disbursement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ trancheNumber: 3 }),
      });
      expect(result.totalDisbursed).toBe(15000000); // 8M + 4M + 3M
    });

    it('предупреждава при усвоено над размера на заявката, но не блокира', async () => {
      disbursement.findMany.mockResolvedValue([
        { trancheNumber: 1, amount: 19000000 },
      ]);

      const result = await service.create(
        'app-1',
        { amount: 5000000, disbursedAt: '2026-05-10' },
        consultant,
      );

      expect(disbursement.create).toHaveBeenCalled(); // НЕ е блокирано
      expect(result.warning).toContain('exceeds the application amount');
    });

    it('дублиран номер на транш → 409', async () => {
      disbursement.findMany.mockResolvedValue([
        { trancheNumber: 1, amount: 1000 },
      ]);

      await expect(
        service.create(
          'app-1',
          { amount: 1000, disbursedAt: '2026-05-10', trancheNumber: 1 },
          consultant,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('заявка преди одобрение → 400', async () => {
      loanApplication.findUnique.mockResolvedValue({
        ...approvedApp,
        status: LoanStatus.OFFER_SELECTED,
      });

      await expect(
        service.create(
          'app-1',
          { amount: 1000, disbursedAt: '2026-05-10' },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('без избрана оферта → 400', async () => {
      bankOffer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          'app-1',
          { amount: 1000, disbursedAt: '2026-05-10' },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('НЕ придвижва заявката автоматично към DISBURSED', async () => {
      await service.create(
        'app-1',
        { amount: 10000000, disbursedAt: '2026-02-10' },
        consultant,
      );
      // Само консултантът решава кой транш е последният
      expect(loanApplication.findUnique).toHaveBeenCalled();
      expect(disbursement.create).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('отказва изтриване при вече записана комисиона', async () => {
      disbursement.findUnique.mockResolvedValue({
        id: 'disb-1',
        offer: { loanApplicationId: 'app-1' },
      });
      trancheCommission.findUnique.mockResolvedValue({ id: 'tc-1' });

      await expect(service.remove('disb-1', consultant)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(disbursement.delete).not.toHaveBeenCalled();
    });

    it('трие транш без комисиона', async () => {
      disbursement.findUnique.mockResolvedValue({
        id: 'disb-1',
        offer: { loanApplicationId: 'app-1' },
      });
      trancheCommission.findUnique.mockResolvedValue(null);
      disbursement.delete.mockResolvedValue({ id: 'disb-1' });

      await expect(service.remove('disb-1', consultant)).resolves.toEqual({
        id: 'disb-1',
        deleted: true,
      });
    });

    it('несъществуващ транш → 404', async () => {
      disbursement.findUnique.mockResolvedValue(null);
      await expect(service.remove('няма', consultant)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('volumeFor — база за скалите', () => {
    it('сумира усвоеното за банка, категория и период', async () => {
      disbursement.aggregate.mockResolvedValue({ _sum: { amount: 27000000 } });
      const period = periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 1);

      const volume = await service.volumeFor(
        'bank-1',
        CommissionLoanCategory.MORTGAGE,
        period,
      );

      expect(volume).toBe(27000000);
      expect(disbursement.aggregate).toHaveBeenCalledWith({
        _sum: { amount: true },
        where: expect.objectContaining({
          disbursedAt: { gte: period.startsAt, lt: period.endsAt },
          offer: expect.objectContaining({
            bankId: 'bank-1',
            loanApplication: {
              loanType: {
                in: [
                  LoanType.MORTGAGE_NO_PURCHASE,
                  LoanType.MORTGAGE_WITH_PURCHASE,
                ],
              },
            },
          }),
        }),
      });
    });

    it('период без усвоявания → 0, не null', async () => {
      disbursement.aggregate.mockResolvedValue({ _sum: { amount: null } });
      const volume = await service.volumeFor(
        'bank-1',
        CommissionLoanCategory.CONSUMER,
        periodByIndex(CommissionPeriodType.MONTHLY, 2026, 3),
      );
      expect(volume).toBe(0);
    });
  });
});

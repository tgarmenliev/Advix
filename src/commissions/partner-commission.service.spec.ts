import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PartnerCommissionModel,
  PartnerCommissionStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { PartnerCommissionService } from './partner-commission.service';

describe('PartnerCommissionService', () => {
  let service: PartnerCommissionService;

  const commissionRecord = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const loanApplication = { findUnique: jest.fn() };
  const disbursement = { aggregate: jest.fn() };
  const trancheCommission = { findMany: jest.fn() };
  const db = {
    commissionRecord,
    loanApplication,
    disbursement,
    trancheCommission,
  };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };
  const admin: AuthenticatedUser = { ...consultant, userId: 'admin-1', role: UserRole.ADMIN };
  const partnerA: AuthenticatedUser = {
    ...consultant,
    userId: 'partner-1',
    role: UserRole.PARTNER_A,
  };

  /** Сделка: усвоени 200 000 €, комисиона очаквана 2 000 €, получена 0 */
  const setBasis = (expected = 200_000, received = 0, disbursed = 20_000_000) => {
    disbursement.aggregate.mockResolvedValue({ _sum: { amount: disbursed } });
    trancheCommission.findMany.mockResolvedValue([
      { expectedAmount: expected, actualAmount: received || null },
    ]);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    loanApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      partnerId: 'partner-1',
    });
    commissionRecord.findUnique.mockResolvedValue({
      id: 'rec-1',
      loanApplicationId: 'app-1',
      partnerCommissionStatus: null,
      partnerCommissionModel: null,
      partnerCommissionPercent: null,
      partnerCommissionFixed: null,
      partnerCommissionAmount: null,
      partnerId: null,
    });
    commissionRecord.update.mockResolvedValue({});
    setBasis();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PartnerCommissionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(PartnerCommissionService);
  });

  describe('computeAmount — трите модела', () => {
    const basis = {
      totalDisbursed: 20_000_000, // 200 000 €
      expectedCommission: 200_000, // 2 000 €
      receivedCommission: 0,
    };

    it('фиксирана сума — не зависи от размера', () => {
      expect(
        service.computeAmount(PartnerCommissionModel.FIXED, null, 30_000, basis),
      ).toBe(30_000); // 300 €
    });

    it('процент от отпуснатата сума: 0,3% от 200 000 € = 600 €', () => {
      expect(
        service.computeAmount(
          PartnerCommissionModel.PERCENT_OF_LOAN,
          0.003,
          null,
          basis,
        ),
      ).toBe(60_000);
    });

    it('процент от комисионата: 20% от 2 000 € = 400 €', () => {
      expect(
        service.computeAmount(
          PartnerCommissionModel.PERCENT_OF_COMMISSION,
          0.2,
          null,
          basis,
        ),
      ).toBe(40_000);
    });

    it('при получена комисиона базата е реално полученото, не очакваното', () => {
      expect(
        service.computeAmount(
          PartnerCommissionModel.PERCENT_OF_COMMISSION,
          0.2,
          null,
          { ...basis, receivedCommission: 150_000 }, // банката плати по-малко
        ),
      ).toBe(30_000); // 20% от 1 500 €, не от 2 000 €
    });
  });

  describe('propose', () => {
    it('партньор предлага → статус PROPOSED, без замразена сума', async () => {
      await service.propose(
        'app-1',
        { model: PartnerCommissionModel.PERCENT_OF_COMMISSION, percent: 0.2 },
        partnerA,
      );

      const data = (
        commissionRecord.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.partnerCommissionStatus).toBe(PartnerCommissionStatus.PROPOSED);
      expect(data.partnerCommissionAmount).toBeNull();
      expect(data.partnerCommissionProposedById).toBe('partner-1');
      expect(data.partnerId).toBe('partner-1'); // снимка на партньора
    });

    it('ADMIN въвежда → веднага APPROVED със замразена сума', async () => {
      await service.propose(
        'app-1',
        { model: PartnerCommissionModel.FIXED, fixed: 30_000 },
        admin,
      );

      const data = (
        commissionRecord.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.partnerCommissionStatus).toBe(PartnerCommissionStatus.APPROVED);
      expect(data.partnerCommissionAmount).toBe(30_000);
      expect(data.partnerCommissionApprovedById).toBe('admin-1');
    });

    it('заявка без партньор → 400', async () => {
      loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        partnerId: null,
      });
      await expect(
        service.propose(
          'app-1',
          { model: PartnerCommissionModel.FIXED, fixed: 1000 },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('фиксиран модел без сума → 400', async () => {
      await expect(
        service.propose(
          'app-1',
          { model: PartnerCommissionModel.FIXED },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('процентен модел с фиксирана сума → 400', async () => {
      await expect(
        service.propose(
          'app-1',
          {
            model: PartnerCommissionModel.PERCENT_OF_LOAN,
            percent: 0.003,
            fixed: 1000,
          },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('вече изплатена комисиона не се предоговаря → 400', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        id: 'rec-1',
        partnerCommissionStatus: PartnerCommissionStatus.PAID,
      });
      await expect(
        service.propose(
          'app-1',
          { model: PartnerCommissionModel.FIXED, fixed: 1000 },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('approve / pay', () => {
    const proposed = {
      id: 'rec-1',
      loanApplicationId: 'app-1',
      partnerCommissionStatus: PartnerCommissionStatus.PROPOSED,
      partnerCommissionModel: PartnerCommissionModel.PERCENT_OF_COMMISSION,
      partnerCommissionPercent: 0.2,
      partnerCommissionFixed: null,
      partnerCommissionAmount: null,
      partnerId: 'partner-1',
    };

    it('одобрението замразява сумата към този момент', async () => {
      commissionRecord.findUnique.mockResolvedValue(proposed);

      await service.approve('app-1', admin);

      const data = (
        commissionRecord.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.partnerCommissionStatus).toBe(PartnerCommissionStatus.APPROVED);
      expect(data.partnerCommissionAmount).toBe(40_000); // 20% от 2 000 €
      expect(data.partnerCommissionApprovedAt).toBeInstanceOf(Date);
    });

    it('не може да се одобри вече одобрена', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        ...proposed,
        partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
      });
      await expect(service.approve('app-1', admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('плащане преди банката да е платила → 400', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        ...proposed,
        partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        partnerCommissionAmount: 40_000,
      });
      setBasis(200_000, 0); // нищо получено още

      await expect(service.pay('app-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('плащане след получена комисиона записва нетния приход', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        ...proposed,
        partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        partnerCommissionAmount: 40_000,
      });
      setBasis(200_000, 200_000); // банката плати 2 000 €

      await service.pay('app-1');

      const data = (
        commissionRecord.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.partnerCommissionStatus).toBe(PartnerCommissionStatus.PAID);
      expect(data.netRevenue).toBe(160_000); // 2 000 − 400 = 1 600 €
      expect(data.partnerCommissionPaidAt).toBeInstanceOf(Date);
    });
  });

  describe('recalculate', () => {
    it('обновява замразената сума при одобрена комисиона', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        id: 'rec-1',
        loanApplicationId: 'app-1',
        partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        partnerCommissionModel: PartnerCommissionModel.PERCENT_OF_COMMISSION,
        partnerCommissionPercent: 0.2,
        partnerCommissionFixed: null,
        partnerCommissionAmount: 40_000,
      });
      setBasis(300_000, 0); // банката вдигна процента → комисионата стана 3 000 €

      await service.recalculate('app-1');

      expect(commissionRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { partnerCommissionAmount: 60_000 }, // 20% от 3 000 €
      });
    });

    it('вече изплатена не се преизчислява → 400', async () => {
      commissionRecord.findUnique.mockResolvedValue({
        id: 'rec-1',
        partnerCommissionStatus: PartnerCommissionStatus.PAID,
        partnerCommissionModel: PartnerCommissionModel.FIXED,
        partnerCommissionFixed: 1000,
        partnerCommissionPercent: null,
      });
      await expect(service.recalculate('app-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('без предложение → 404', async () => {
      commissionRecord.findUnique.mockResolvedValue(null);
      await expect(service.recalculate('app-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

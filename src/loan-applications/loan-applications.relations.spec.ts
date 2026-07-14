import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoanType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

/**
 * Тестове за връзките на заявката: свързани лица (junction) и имоти.
 */
describe('LoanApplicationsService — relations', () => {
  let service: LoanApplicationsService;

  const loanApplicationDelegate = { findUnique: jest.fn() };
  const familyMemberDelegate = { findFirst: jest.fn() };
  const lafmDelegate = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const propertyDelegate = { findUnique: jest.fn() };
  const lapDelegate = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const bankDelegate = { findUnique: jest.fn() };

  const prismaMock = {
    get tenantDb() {
      return {
        loanApplication: loanApplicationDelegate,
        familyMember: familyMemberDelegate,
        loanApplicationFamilyMember: lafmDelegate,
        property: propertyDelegate,
        loanApplicationProperty: lapDelegate,
        bank: bankDelegate,
      };
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoanApplicationsService,
        WorkflowService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(LoanApplicationsService);
  });

  describe('addFamilyMember', () => {
    it('включва лице от СЪЩИЯ клиент', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
      });
      familyMemberDelegate.findFirst.mockResolvedValue({
        id: 'fm-1',
        clientId: 'client-1',
      });
      lafmDelegate.findUnique.mockResolvedValue(null);
      lafmDelegate.create.mockResolvedValue({
        loanApplicationId: 'app-1',
        familyMemberId: 'fm-1',
      });

      await service.addFamilyMember('app-1', 'fm-1');

      expect(lafmDelegate.create).toHaveBeenCalledWith({
        data: { loanApplicationId: 'app-1', familyMemberId: 'fm-1' },
        include: { familyMember: true },
      });
    });

    it('отхвърля лице от ДРУГ клиент → BadRequestException', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
      });
      familyMemberDelegate.findFirst.mockResolvedValue({
        id: 'fm-чужд',
        clientId: 'client-ДРУГ',
      });

      await expect(
        service.addFamilyMember('app-1', 'fm-чужд'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lafmDelegate.create).not.toHaveBeenCalled();
    });

    it('отхвърля повторно включване → ConflictException', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
      });
      familyMemberDelegate.findFirst.mockResolvedValue({
        id: 'fm-1',
        clientId: 'client-1',
      });
      lafmDelegate.findUnique.mockResolvedValue({ loanApplicationId: 'app-1' });

      await expect(
        service.addFamilyMember('app-1', 'fm-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('хвърля NotFoundException при soft-deleted лице', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
      });
      familyMemberDelegate.findFirst.mockResolvedValue(null); // deletedAt филтър

      await expect(
        service.addFamilyMember('app-1', 'fm-изтрит'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('linkProperty', () => {
    const mortgageApp = {
      id: 'app-1',
      clientId: 'client-1',
      loanType: LoanType.MORTGAGE_WITH_PURCHASE,
    };

    it('пази marketValue и mortgageBankId в junction записа', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue(mortgageApp);
      propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
      bankDelegate.findUnique.mockResolvedValue({ id: 'bank-1' });
      lapDelegate.findUnique.mockResolvedValue(null);
      lapDelegate.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'link-1', ...data }),
      );

      const result = await service.linkProperty('app-1', {
        propertyId: 'prop-1',
        marketValue: 30000000,
        mortgageBankId: 'bank-1',
      });

      expect(lapDelegate.create).toHaveBeenCalledWith({
        data: {
          loanApplicationId: 'app-1',
          propertyId: 'prop-1',
          marketValue: 30000000,
          mortgageBankId: 'bank-1',
        },
        include: { property: true },
      });
      // При ипотечен кредит имотът е очакван — няма warning
      expect(result).not.toHaveProperty('warning');
    });

    it('CONSUMER заявка → warning в отговора, без блокиране', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue({
        ...mortgageApp,
        loanType: LoanType.CONSUMER,
      });
      propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
      lapDelegate.findUnique.mockResolvedValue(null);
      lapDelegate.create.mockResolvedValue({ id: 'link-1' });

      const result = await service.linkProperty('app-1', {
        propertyId: 'prop-1',
      });

      expect(lapDelegate.create).toHaveBeenCalled(); // НЕ е блокирано
      expect(result).toHaveProperty('warning');
      expect((result as { warning: string }).warning).toContain('CONSUMER');
    });

    it('хвърля BadRequestException при несъществуваща банка', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue(mortgageApp);
      propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
      bankDelegate.findUnique.mockResolvedValue(null);

      await expect(
        service.linkProperty('app-1', {
          propertyId: 'prop-1',
          mortgageBankId: 'missing-bank',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

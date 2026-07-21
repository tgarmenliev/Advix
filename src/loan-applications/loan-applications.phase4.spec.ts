import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoanStatus, LoanType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService, PartnerLeadView } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

/**
 * Тестове за поведението, добавено във Фаза 4:
 * хлабаво създаване, назначаване на консултант, видимост по роля,
 * и ADMIN връщане за корекция от всеки статус.
 */
describe('LoanApplicationsService — phase 4', () => {
  let service: LoanApplicationsService;

  const loanApp = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const statusHistory = { create: jest.fn() };
  const clientDelegate = { findFirst: jest.fn() };
  const userDelegate = { findFirst: jest.fn() };

  const txMock = { loanApplication: loanApp, loanStatusHistory: statusHistory };

  const prismaMock = {
    get tenantDb() {
      return {
        loanApplication: loanApp,
        loanStatusHistory: statusHistory,
        client: clientDelegate,
        $transaction: (
          arg: unknown[] | ((tx: typeof txMock) => Promise<unknown>),
        ) => (typeof arg === 'function' ? arg(txMock) : Promise.all(arg)),
      };
    },
    get publicDb() {
      return { user: userDelegate };
    },
  };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };
  const partnerA: AuthenticatedUser = {
    userId: 'partner-a-1',
    tenantId: 'tenant-1',
    email: 'pa@test.bg',
    role: UserRole.PARTNER_A,
  };
  const admin: AuthenticatedUser = {
    userId: 'admin-1',
    tenantId: 'tenant-1',
    email: 'a@test.bg',
    role: UserRole.ADMIN,
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

  describe('хлабаво създаване', () => {
    beforeEach(() => {
      clientDelegate.findFirst.mockResolvedValue({ id: 'client-1' });
      loanApp.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'app-1', ...data }),
      );
      statusHistory.create.mockResolvedValue({});
    });

    it('създава заявка без termMonths (termMonths = null)', async () => {
      await service.create(
        {
          clientId: 'client-1',
          loanType: LoanType.CONSUMER,
          amount: 500000,
        },
        consultant,
      );

      expect(loanApp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ termMonths: null }),
      });
    });

    it('CONSULTANT създава на свое име (consultantId = self)', async () => {
      await service.create(
        { clientId: 'client-1', loanType: LoanType.CONSUMER, amount: 500000 },
        consultant,
      );
      expect(loanApp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          consultantId: 'consultant-1',
          partnerId: null,
        }),
      });
    });

    it('PARTNER_A създава лийд без консултант (consultantId = null, partnerId = self)', async () => {
      await service.create(
        { clientId: 'client-1', loanType: LoanType.CONSUMER, amount: 500000 },
        partnerA,
      );
      expect(loanApp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          consultantId: null,
          partnerId: 'partner-a-1',
        }),
      });
    });
  });

  describe('assignConsultant (само ADMIN)', () => {
    it('назначава консултант при валиден оператор в същия tenant', async () => {
      loanApp.findUnique.mockResolvedValue({ id: 'app-1' });
      userDelegate.findFirst.mockResolvedValue({
        id: 'consultant-9',
        tenantId: 'tenant-1',
        isActive: true,
        role: UserRole.CONSULTANT,
      });
      loanApp.update.mockResolvedValue({
        id: 'app-1',
        consultantId: 'consultant-9',
      });

      const result = await service.assignConsultant(
        'app-1',
        'consultant-9',
        admin,
      );

      expect(loanApp.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { consultantId: 'consultant-9' },
      });
      expect(result.consultantId).toBe('consultant-9');
    });

    it('отхвърля назначаване на PARTNER_A като консултант', async () => {
      loanApp.findUnique.mockResolvedValue({ id: 'app-1' });
      userDelegate.findFirst.mockResolvedValue({
        id: 'partner-a-2',
        tenantId: 'tenant-1',
        isActive: true,
        role: UserRole.PARTNER_A,
      });

      await expect(
        service.assignConsultant('app-1', 'partner-a-2', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(loanApp.update).not.toHaveBeenCalled();
    });

    it('отхвърля потребител, който не е в този tenant', async () => {
      loanApp.findUnique.mockResolvedValue({ id: 'app-1' });
      userDelegate.findFirst.mockResolvedValue(null); // филтърът по tenantId не намира

      await expect(
        service.assignConsultant('app-1', 'foreign-user', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('видимост по роля (findAll)', () => {
    beforeEach(() => {
      loanApp.findMany.mockResolvedValue([]);
      loanApp.count.mockResolvedValue(0);
    });

    const whereOf = () =>
      (loanApp.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
        .where;

    it('ADMIN вижда всички (без scope по собственост)', async () => {
      await service.findAll({ page: 1, limit: 20 }, admin);
      const where = whereOf();
      expect(where.consultantId).toBeUndefined();
      expect(where.partnerId).toBeUndefined();
    });

    it('CONSULTANT вижда само своите (consultantId = self)', async () => {
      await service.findAll({ page: 1, limit: 20 }, consultant);
      expect(whereOf().consultantId).toBe('consultant-1');
    });

    it('PARTNER_A вижда само своите лийдове (partnerId = self)', async () => {
      await service.findAll({ page: 1, limit: 20 }, partnerA);
      expect(whereOf().partnerId).toBe('partner-a-1');
    });
  });

  describe('findOne — ограничен изглед за PARTNER_A', () => {
    it('връща само базови данни, без пълното досие', async () => {
      loanApp.findUnique.mockResolvedValue({
        id: 'app-1',
        loanType: LoanType.CONSUMER,
        amount: 500000,
        termMonths: null,
        purpose: 'ремонт',
        status: LoanStatus.NEW,
        createdAt: new Date(),
        consultantId: null,
        partnerId: 'partner-a-1', // собственост на партньора
        internalNotes: 'вътрешна бележка — НЕ трябва да се вижда',
        client: {
          id: 'client-1',
          firstName: 'Иван',
          lastName: 'Петров',
          phone: '0888',
          egn: '8506151239', // чувствително — НЕ трябва да се вижда
          familyMembers: [{ id: 'fm-1' }],
        },
        statusHistory: [{ toStatus: 'NEW' }],
      });

      const result = (await service.findOne('app-1', partnerA)) as PartnerLeadView;

      expect(result.id).toBe('app-1');
      expect(result.client.firstName).toBe('Иван');
      // Ограниченият изглед НЕ съдържа вътрешни/чувствителни данни
      expect(result).not.toHaveProperty('internalNotes');
      expect(result).not.toHaveProperty('statusHistory');
      expect(result.client).not.toHaveProperty('egn');
      expect(result.client).not.toHaveProperty('familyMembers');
    });
  });

  describe('ADMIN връщане за корекция от всеки статус', () => {
    it('ADMIN може SENT_TO_BANKS → COLLECTING_INFO (иначе невалиден преход)', async () => {
      loanApp.findUnique.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.SENT_TO_BANKS,
        consultantId: 'consultant-1',
        partnerId: null,
        client: {},
      });
      loanApp.update.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.COLLECTING_INFO,
      });
      statusHistory.create.mockResolvedValue({});

      const result = await service.transition(
        'app-1',
        { toStatus: LoanStatus.COLLECTING_INFO, note: 'върни за корекция' },
        admin,
      );

      expect(result.status).toBe(LoanStatus.COLLECTING_INFO);
    });

    it('CONSULTANT НЕ може същия преход (state machine го отхвърля)', async () => {
      loanApp.findUnique.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.SENT_TO_BANKS,
        consultantId: 'consultant-1',
        partnerId: null,
        client: {},
      });

      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.COLLECTING_INFO },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

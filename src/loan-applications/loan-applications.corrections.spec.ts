import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ContractType,
  LoanStatus,
  LoanType,
  RelatedPersonRole,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

/**
 * Тестове за корекциите по Фаза 4: internalNotes write, смяна на loanType,
 * заключване на съдлъжници след финализиране, и flip на роли.
 */
describe('LoanApplicationsService — Phase 4 corrections', () => {
  let service: LoanApplicationsService;

  const db = {
    loanApplication: { findUnique: jest.fn(), update: jest.fn() },
    loanApplicationFamilyMember: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    familyMember: { findFirst: jest.fn(), create: jest.fn() },
    client: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
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
    Object.values(db).forEach((delegate) => {
      if (typeof delegate === 'object') {
        Object.values(delegate).forEach(
          (fn) => typeof fn === 'function' && (fn as jest.Mock).mockReset(),
        );
      }
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoanApplicationsService,
        WorkflowService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(LoanApplicationsService);
  });

  describe('internalNotes — write достъп', () => {
    it('PARTNER_A НЕ може да пише internalNotes (собственик на лийда) → Forbidden', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        consultantId: null,
        partnerId: 'partner-a-1', // партньорът е собственик
      });

      await expect(
        service.update('app-1', { internalNotes: 'опит' }, partnerA),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.loanApplication.update).not.toHaveBeenCalled();
    });

    it('CONSULTANT (собственик) МОЖЕ да пише internalNotes', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        consultantId: 'consultant-1',
        partnerId: null,
      });
      db.loanApplication.update.mockResolvedValue({ id: 'app-1' });

      await service.update('app-1', { internalNotes: 'вътрешна' }, consultant);
      expect(db.loanApplication.update).toHaveBeenCalled();
    });

    it('PARTNER_A МОЖЕ да редактира не-бележкови полета (напр. purpose)', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        consultantId: null,
        partnerId: 'partner-a-1',
      });
      db.loanApplication.update.mockResolvedValue({ id: 'app-1' });

      await service.update('app-1', { purpose: 'ремонт' }, partnerA);
      expect(db.loanApplication.update).toHaveBeenCalled();
    });
  });

  describe('changeLoanType', () => {
    it('сменя типа при нетерминален статус', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.COLLECTING_INFO,
      });
      db.loanApplication.update.mockResolvedValue({
        id: 'app-1',
        loanType: LoanType.BUSINESS,
      });

      const result = await service.changeLoanType(
        'app-1',
        LoanType.BUSINESS,
        admin,
      );
      expect(result.loanType).toBe(LoanType.BUSINESS);
      expect(db.loanApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { loanType: LoanType.BUSINESS },
      });
    });

    it('отказва смяна при терминален статус (COMPLETED)', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.COMPLETED,
      });

      await expect(
        service.changeLoanType('app-1', LoanType.BUSINESS, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.loanApplication.update).not.toHaveBeenCalled();
    });
  });

  describe('съдлъжници — заключване след финализиране', () => {
    it('добавяне в NEW статус минава до проверката за лицето', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
        consultantId: 'consultant-1',
        partnerId: null,
        status: LoanStatus.NEW,
      });
      db.familyMember.findFirst.mockResolvedValue(null); // спира на "лице не намерено"

      await expect(
        service.addFamilyMember('app-1', 'fm-1', consultant),
      ).rejects.not.toBeInstanceOf(BadRequestException);
      // (NotFound, не BadRequest — значи статус-гейтът е пропуснал NEW)
    });

    it('добавяне в COMPLETED → BadRequestException (заключено)', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
        consultantId: 'consultant-1',
        partnerId: null,
        status: LoanStatus.COMPLETED,
      });

      await expect(
        service.addFamilyMember('app-1', 'fm-1', consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.familyMember.findFirst).not.toHaveBeenCalled();
    });

    it('премахване в DISBURSED → BadRequestException', async () => {
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
        consultantId: 'consultant-1',
        partnerId: null,
        status: LoanStatus.DISBURSED,
      });

      await expect(
        service.removeFamilyMember('app-1', 'fm-1', consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('flipBorrower', () => {
    const setupApp = (status: LoanStatus = LoanStatus.COLLECTING_INFO) =>
      db.loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-C',
        consultantId: 'consultant-1',
        partnerId: null,
        status,
      });

    const member = {
      id: 'fm-M',
      clientId: 'client-C',
      egn: '5209231178',
      firstName: 'Мария',
      lastName: 'Петрова',
      age: 73,
      email: null,
      phone: null,
      employer: null,
      jobTitle: null,
      contractType: ContractType.PERMANENT,
      netSalary: 150000,
      existingLoansTotal: null,
      existingLoansMonthlyTotal: null,
      gdprConsentAt: null,
      gdprDocumentId: null,
    };
    const oldClient = {
      id: 'client-C',
      egn: '8506151239',
      firstName: 'Иван',
      lastName: 'Иванов',
      age: 41,
      email: null,
      phone: null,
      employer: null,
      jobTitle: null,
      contractType: ContractType.PERMANENT,
      netSalary: 200000,
      existingLoansTotal: null,
      existingLoansMonthlyTotal: null,
      gdprConsentAt: null,
      gdprDocumentId: null,
      deletedAt: null,
    };

    it('разменя ролите: съдлъжникът става клиент, клиентът — съдлъжник', async () => {
      setupApp();
      db.loanApplicationFamilyMember.findUnique
        .mockResolvedValueOnce({ loanApplicationId: 'app-1' }) // link check
        .mockResolvedValueOnce(null); // demotedLink
      db.familyMember.findFirst
        .mockResolvedValueOnce(member) // member
        .mockResolvedValueOnce(null); // existingDemoted
      db.client.findFirst.mockResolvedValue(oldClient);
      db.client.findUnique.mockResolvedValue(null); // няма Client по ЕГН на M
      db.client.create.mockResolvedValue({ id: 'client-M', egn: member.egn });
      db.familyMember.create.mockResolvedValue({
        id: 'fm-C',
        clientId: 'client-M',
      });
      db.loanApplication.update.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-M',
      });

      const result = await service.flipBorrower('app-1', 'fm-M', consultant);

      // Съдлъжникът → нов Client (от неговите данни)
      expect(db.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ egn: member.egn, netSalary: 150000 }),
      });
      // Старият клиент → съдлъжник (роля CO_BORROWER, под новия клиент)
      expect(db.familyMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-M',
          egn: oldClient.egn,
          role: RelatedPersonRole.CO_BORROWER,
        }),
      });
      // Заявката сочи новия клиент
      expect(db.loanApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { clientId: 'client-M' },
      });
      expect(result.clientId).toBe('client-M');
    });

    it('дедуп: ако човекът вече е Client по ЕГН → не създава дубликат', async () => {
      setupApp();
      db.loanApplicationFamilyMember.findUnique
        .mockResolvedValueOnce({ loanApplicationId: 'app-1' })
        .mockResolvedValueOnce(null);
      db.familyMember.findFirst
        .mockResolvedValueOnce(member)
        .mockResolvedValueOnce(null);
      db.client.findFirst.mockResolvedValue(oldClient);
      // Вече съществува Client с ЕГН на M
      db.client.findUnique.mockResolvedValue({
        id: 'client-M-съществуващ',
        egn: member.egn,
        deletedAt: null,
      });
      db.familyMember.create.mockResolvedValue({ id: 'fm-C' });
      db.loanApplication.update.mockResolvedValue({ id: 'app-1' });

      await service.flipBorrower('app-1', 'fm-M', consultant);

      expect(db.client.create).not.toHaveBeenCalled(); // без дубликат
      expect(db.loanApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { clientId: 'client-M-съществуващ' },
      });
    });

    it('след финализиране (COMPLETED) → отказан', async () => {
      setupApp(LoanStatus.COMPLETED);

      await expect(
        service.flipBorrower('app-1', 'fm-M', consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('лице, което НЕ е в заявката → BadRequestException', async () => {
      setupApp();
      db.loanApplicationFamilyMember.findUnique.mockResolvedValueOnce(null); // няма link

      await expect(
        service.flipBorrower('app-1', 'fm-външен', consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.loanApplication.update).not.toHaveBeenCalled();
    });
  });
});

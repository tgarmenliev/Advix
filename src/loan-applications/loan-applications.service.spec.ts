import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContractType, LoanStatus, LoanType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

describe('LoanApplicationsService', () => {
  let service: LoanApplicationsService;

  const loanApplicationDelegate = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const loanStatusHistoryDelegate = {
    create: jest.fn(),
  };
  const clientDelegate = {
    findFirst: jest.fn(),
  };

  const txMock = {
    loanApplication: loanApplicationDelegate,
    loanStatusHistory: loanStatusHistoryDelegate,
  };

  const tenantDbMock = {
    loanApplication: loanApplicationDelegate,
    loanStatusHistory: loanStatusHistoryDelegate,
    client: clientDelegate,
    $transaction: jest.fn(
      (arg: unknown[] | ((tx: typeof txMock) => Promise<unknown>)) =>
        typeof arg === 'function' ? arg(txMock) : Promise.all(arg),
    ),
  };

  const prismaMock = {
    get tenantDb() {
      return tenantDbMock;
    },
  };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'consultant@test.bg',
    role: UserRole.CONSULTANT,
  };

  const fullClient = {
    id: 'client-1',
    egn: '8506151239',
    netSalary: 350000,
    contractType: ContractType.PERMANENT,
    gdprConsentAt: new Date(),
  };

  const makeApplication = (overrides: Record<string, unknown> = {}) => ({
    id: 'app-1',
    clientId: 'client-1',
    status: LoanStatus.INTERNAL_PROCESSING,
    amount: 5000000,
    termMonths: 240,
    client: fullClient,
    ...overrides,
  });

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

  describe('create', () => {
    it('създава заявка със статус NEW и начален запис в историята', async () => {
      clientDelegate.findFirst.mockResolvedValue({ id: 'client-1' });
      loanApplicationDelegate.create.mockResolvedValue({
        id: 'app-1',
        status: LoanStatus.NEW,
      });
      loanStatusHistoryDelegate.create.mockResolvedValue({});

      const result = await service.create(
        {
          clientId: 'client-1',
          loanType: LoanType.MORTGAGE_WITH_PURCHASE,
          amount: 5000000,
          termMonths: 240,
        },
        consultant,
      );

      expect(result.status).toBe(LoanStatus.NEW);
      expect(loanApplicationDelegate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: LoanStatus.NEW,
          consultantId: 'consultant-1', // от текущия потребител
        }),
      });
      expect(loanStatusHistoryDelegate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromStatus: null,
          toStatus: LoanStatus.NEW,
          changedByUserId: 'consultant-1',
        }),
      });
    });

    it('хвърля NotFoundException при несъществуващ клиент', async () => {
      clientDelegate.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            clientId: 'missing',
            loanType: LoanType.CONSUMER,
            amount: 100000,
            termMonths: 12,
          },
          consultant,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('transition — workflow', () => {
    it('изпълнява валиден преход и записва историята', async () => {
      const app = makeApplication();
      loanApplicationDelegate.findUnique.mockResolvedValue(app);
      loanApplicationDelegate.update.mockResolvedValue({
        ...app,
        status: LoanStatus.READY_FOR_BANK,
      });
      loanStatusHistoryDelegate.create.mockResolvedValue({});

      const result = await service.transition(
        'app-1',
        { toStatus: LoanStatus.READY_FOR_BANK, note: 'готово' },
        consultant,
      );

      expect(result.status).toBe(LoanStatus.READY_FOR_BANK);
      expect(loanStatusHistoryDelegate.create).toHaveBeenCalledWith({
        data: {
          loanApplicationId: 'app-1',
          fromStatus: LoanStatus.INTERNAL_PROCESSING,
          toStatus: LoanStatus.READY_FOR_BANK,
          changedByUserId: 'consultant-1',
          note: 'готово',
        },
      });
    });

    it('отхвърля невалиден преход NEW → READY_FOR_BANK', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue(
        makeApplication({ status: LoanStatus.NEW }),
      );

      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.READY_FOR_BANK },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(loanApplicationDelegate.update).not.toHaveBeenCalled();
    });
  });

  describe('transition — READY_FOR_BANK валидация', () => {
    it('връща точния списък липсващи полета', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue(
        makeApplication({
          client: {
            id: 'client-1',
            egn: null,
            netSalary: null,
            contractType: null,
            gdprConsentAt: null,
          },
        }),
      );

      const error = await service
        .transition(
          'app-1',
          { toStatus: LoanStatus.READY_FOR_BANK },
          consultant,
        )
        .catch((e: BadRequestException) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        (error as BadRequestException).getResponse(),
      ).toEqual(
        expect.objectContaining({
          missingFields: [
            'client.egn',
            'client.netSalary',
            'client.contractType',
            'client.gdprConsentAt',
          ],
        }),
      );
      expect(loanApplicationDelegate.update).not.toHaveBeenCalled();
    });

    it('минава при попълнени всички задължителни полета', async () => {
      const app = makeApplication();
      loanApplicationDelegate.findUnique.mockResolvedValue(app);
      loanApplicationDelegate.update.mockResolvedValue({
        ...app,
        status: LoanStatus.READY_FOR_BANK,
      });
      loanStatusHistoryDelegate.create.mockResolvedValue({});

      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.READY_FOR_BANK },
          consultant,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('transition — права по роля', () => {
    it('CLIENT не може да сменя статуси изобщо', async () => {
      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.COLLECTING_INFO },
          { ...consultant, role: UserRole.CLIENT },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(loanApplicationDelegate.findUnique).not.toHaveBeenCalled();
    });

    it('PARTNER_B не може SENT_TO_BANKS без ADMIN одобрение', async () => {
      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.SENT_TO_BANKS },
          { ...consultant, role: UserRole.PARTNER_B },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PARTNER_A не може SENT_TO_BANKS', async () => {
      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.SENT_TO_BANKS },
          { ...consultant, role: UserRole.PARTNER_A },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('CONSULTANT може SENT_TO_BANKS директно', async () => {
      const app = makeApplication({ status: LoanStatus.READY_FOR_BANK });
      loanApplicationDelegate.findUnique.mockResolvedValue(app);
      loanApplicationDelegate.update.mockResolvedValue({
        ...app,
        status: LoanStatus.SENT_TO_BANKS,
      });
      loanStatusHistoryDelegate.create.mockResolvedValue({});

      await expect(
        service.transition(
          'app-1',
          { toStatus: LoanStatus.SENT_TO_BANKS },
          consultant,
        ),
      ).resolves.toBeDefined();
    });
  });
});

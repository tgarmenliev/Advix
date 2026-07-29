import { Test } from '@nestjs/testing';
import { LoanStatus, OfferStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

/**
 * При преход на заявката избраната оферта следва статуса ѝ.
 * Неизбраните (PENDING) и отпадналите (REJECTED) не се пипат.
 */
describe('LoanApplicationsService — синхронизация с избраната оферта', () => {
  let service: LoanApplicationsService;

  const loanApplication = { findUnique: jest.fn(), update: jest.fn() };
  const loanStatusHistory = { create: jest.fn() };
  const bankOffer = { updateMany: jest.fn() };
  const db = {
    loanApplication,
    loanStatusHistory,
    bankOffer,
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

  const transitionFrom = async (from: LoanStatus, to: LoanStatus) => {
    loanApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      status: from,
      consultantId: 'consultant-1',
      partnerId: null,
      client: {},
    });
    loanApplication.update.mockResolvedValue({ id: 'app-1', status: to });
    loanStatusHistory.create.mockResolvedValue({});
    bankOffer.updateMany.mockResolvedValue({ count: 1 });
    await service.transition('app-1', { toStatus: to }, consultant);
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

  it.each([
    [
      LoanStatus.OFFER_SELECTED,
      LoanStatus.APPLICATION_SUBMITTED,
      OfferStatus.APPLICATION_SUBMITTED,
    ],
    [
      LoanStatus.APPLICATION_SUBMITTED,
      LoanStatus.APPROVED,
      OfferStatus.APPROVED,
    ],
    [LoanStatus.APPROVED, LoanStatus.DISBURSED, OfferStatus.DISBURSED],
    [
      LoanStatus.APPLICATION_SUBMITTED,
      LoanStatus.REJECTED_BY_BANK,
      OfferStatus.REJECTED,
    ],
  ])('заявка %s → %s дава оферта %s', async (from, to, expectedOfferStatus) => {
    await transitionFrom(from, to);

    expect(bankOffer.updateMany).toHaveBeenCalledWith({
      where: {
        loanApplicationId: 'app-1',
        status: { notIn: [OfferStatus.PENDING, OfferStatus.REJECTED] },
      },
      data: { status: expectedOfferStatus },
    });
  });

  it('преход без съответствие за офертата не я пипа', async () => {
    await transitionFrom(LoanStatus.NEW, LoanStatus.COLLECTING_INFO);
    expect(bankOffer.updateMany).not.toHaveBeenCalled();
  });
});

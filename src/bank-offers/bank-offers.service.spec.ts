import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InquiryStatus, OfferStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { BankOffersService } from './bank-offers.service';
import { OfferComparisonService } from './offer-comparison.service';

describe('BankOffersService', () => {
  let service: BankOffersService;

  const bankOffer = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const bankInquiry = { findUnique: jest.fn(), update: jest.fn() };
  const bank = { findUnique: jest.fn() };
  const db = {
    bankOffer,
    bankInquiry,
    bank,
    $transaction: (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };
  const loanAppsMock = {
    markOffersReceived: jest.fn(),
    markOfferSelected: jest.fn(),
    assertAccessById: jest.fn(),
  };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BankOffersService,
        OfferComparisonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LoanApplicationsService, useValue: loanAppsMock },
      ],
    }).compile();
    service = moduleRef.get(BankOffersService);
  });

  describe('create', () => {
    beforeEach(() => {
      loanAppsMock.markOffersReceived.mockResolvedValue({ id: 'app-1' });
      bank.findUnique.mockResolvedValue({ id: 'bank-1', name: 'ДСК' });
      bankOffer.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'offer-1', ...data }),
      );
    });

    it('записва оферта със статус PENDING и придвижва заявката', async () => {
      const result = await service.create(
        'app-1',
        { bankId: 'bank-1', totalRepayment: 5000000 },
        consultant,
      );

      expect(loanAppsMock.markOffersReceived).toHaveBeenCalledWith(
        'app-1',
        consultant,
      );
      expect(bankOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          loanApplicationId: 'app-1',
          bankId: 'bank-1',
          status: OfferStatus.PENDING,
          totalRepayment: 5000000,
        }),
      });
      expect(result.status).toBe(OfferStatus.PENDING);
    });

    it('при подадено запитване го маркира като OFFER_RECEIVED', async () => {
      bankInquiry.findUnique.mockResolvedValue({
        id: 'inq-1',
        loanApplicationId: 'app-1',
        offer: null,
      });

      await service.create(
        'app-1',
        { bankId: 'bank-1', inquiryId: 'inq-1' },
        consultant,
      );

      expect(bankInquiry.update).toHaveBeenCalledWith({
        where: { id: 'inq-1' },
        data: { status: InquiryStatus.OFFER_RECEIVED },
      });
    });

    it('запитване от друга заявка → BadRequestException', async () => {
      bankInquiry.findUnique.mockResolvedValue({
        id: 'inq-чуждо',
        loanApplicationId: 'ДРУГА-заявка',
        offer: null,
      });

      await expect(
        service.create(
          'app-1',
          { bankId: 'bank-1', inquiryId: 'inq-чуждо' },
          consultant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bankOffer.create).not.toHaveBeenCalled();
    });

    it('втора оферта по същото запитване → ConflictException', async () => {
      bankInquiry.findUnique.mockResolvedValue({
        id: 'inq-1',
        loanApplicationId: 'app-1',
        offer: { id: 'вече-има' },
      });

      await expect(
        service.create(
          'app-1',
          { bankId: 'bank-1', inquiryId: 'inq-1' },
          consultant,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('несъществуваща банка → BadRequestException', async () => {
      bank.findUnique.mockResolvedValue(null);

      await expect(
        service.create('app-1', { bankId: 'няма' }, consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('select', () => {
    it('избраната става SELECTED, останалите REJECTED, заявката се придвижва', async () => {
      bankOffer.findUnique.mockResolvedValue({
        id: 'offer-1',
        loanApplicationId: 'app-1',
      });
      loanAppsMock.assertAccessById.mockResolvedValue(undefined);
      loanAppsMock.markOfferSelected.mockResolvedValue({ id: 'app-1' });
      bankOffer.updateMany.mockResolvedValue({ count: 2 });
      bankOffer.update.mockResolvedValue({
        id: 'offer-1',
        status: OfferStatus.SELECTED,
      });

      const result = await service.select('offer-1', consultant);

      expect(loanAppsMock.markOfferSelected).toHaveBeenCalledWith(
        'app-1',
        consultant,
      );
      // останалите оферти по заявката отпадат
      expect(bankOffer.updateMany).toHaveBeenCalledWith({
        where: { loanApplicationId: 'app-1', id: { not: 'offer-1' } },
        data: { status: OfferStatus.REJECTED },
      });
      expect(result.selected.status).toBe(OfferStatus.SELECTED);
      expect(result.rejected).toBe(2);
    });

    it('несъществуваща оферта → NotFoundException', async () => {
      bankOffer.findUnique.mockResolvedValue(null);

      await expect(service.select('няма', consultant)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('compare', () => {
    it('проверява достъпа и връща сравнението с бележка за липса на класиране', async () => {
      loanAppsMock.assertAccessById.mockResolvedValue(undefined);
      bankOffer.findMany.mockResolvedValue([]);

      const result = await service.compare('app-1', {}, consultant);

      expect(loanAppsMock.assertAccessById).toHaveBeenCalledWith(
        'app-1',
        consultant,
      );
      expect(result.note).toContain('не класира');
      expect(result.sortedBy).toBeNull();
    });
  });
});

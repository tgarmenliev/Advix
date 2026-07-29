import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InquiryStatus, LoanType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from '../email/email.service';
import { InquiryTemplatesService } from '../inquiry-templates/inquiry-templates.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { BankInquiriesService } from './bank-inquiries.service';

describe('BankInquiriesService', () => {
  let service: BankInquiriesService;

  const loanApplication = { findUnique: jest.fn() };
  const bankContact = { findMany: jest.fn() };
  const bankInquiry = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prismaMock = {
    get tenantDb() {
      return { loanApplication, bankContact, bankInquiry };
    },
  };
  const templatesMock = { getDefault: jest.fn() };
  const emailMock = { send: jest.fn() };
  const loanAppsMock = {
    markSentToBanks: jest.fn(),
    assertAccessById: jest.fn(),
  };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };

  const application = {
    id: 'app-1',
    amount: 25000000, // 250000.00
    loanType: LoanType.MORTGAGE_WITH_PURCHASE,
    termMonths: 300,
    purpose: 'покупка',
    client: { firstName: 'Иван', lastName: 'Петров' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BankInquiriesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: InquiryTemplatesService, useValue: templatesMock },
        { provide: EmailService, useValue: emailMock },
        { provide: LoanApplicationsService, useValue: loanAppsMock },
      ],
    }).compile();
    service = moduleRef.get(BankInquiriesService);
  });

  describe('send', () => {
    beforeEach(() => {
      loanAppsMock.markSentToBanks.mockResolvedValue(application);
      loanApplication.findUnique.mockResolvedValue(application);
      bankContact.findMany.mockResolvedValue([
        {
          id: 'contact-1',
          bankId: 'bank-1',
          email: 'ivan@dsk.bg',
          firstName: 'Асен',
          lastName: 'Кожухаров',
          bank: { name: 'ДСК' },
        },
      ]);
      templatesMock.getDefault.mockResolvedValue({
        id: 'tpl-1',
        subject: 'Запитване за {clientName}',
        body: 'Клиент {clientName}, сума {amount} EUR към {bankName}',
      });
      bankInquiry.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'inq-1', ...data }),
      );
      emailMock.send.mockResolvedValue({
        id: 'dry-1',
        delivered: false,
        dryRun: true,
      });
    });

    it('придвижва към SENT_TO_BANKS и запечатва изпратения текст (snapshot)', async () => {
      const result = await service.send(
        'app-1',
        { bankContactIds: ['contact-1'] },
        consultant,
      );

      expect(loanAppsMock.markSentToBanks).toHaveBeenCalledWith(
        'app-1',
        consultant,
      );
      // snapshot с попълнени placeholder-и
      expect(bankInquiry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          loanApplicationId: 'app-1',
          bankId: 'bank-1',
          bankContactId: 'contact-1',
          status: InquiryStatus.SENT,
          sentContent: 'Клиент Иван Петров, сума 250000.00 EUR към ДСК',
        }),
      });
      // имейлът мина през услугата (dry-run)
      expect(emailMock.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ivan@dsk.bg' }),
      );
      expect(result).toEqual({
        sent: 1,
        results: [
          expect.objectContaining({ bank: 'ДСК', dryRun: true, delivered: false }),
        ],
      });
    });

    it('липсващ контакт → BadRequestException', async () => {
      bankContact.findMany.mockResolvedValue([]); // нито един от заявените

      await expect(
        service.send('app-1', { bankContactIds: ['contact-x'] }, consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bankInquiry.create).not.toHaveBeenCalled();
    });

    it('роля без право (markSentToBanks хвърля) спира изпращането', async () => {
      loanAppsMock.markSentToBanks.mockRejectedValue(
        new BadRequestException('nope'),
      );

      await expect(
        service.send('app-1', { bankContactIds: ['contact-1'] }, consultant),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bankInquiry.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('обновява статуса след проверка на достъп', async () => {
      bankInquiry.findUnique.mockResolvedValue({
        id: 'inq-1',
        loanApplicationId: 'app-1',
      });
      loanAppsMock.assertAccessById.mockResolvedValue(undefined);
      bankInquiry.update.mockResolvedValue({
        id: 'inq-1',
        status: InquiryStatus.OFFER_RECEIVED,
      });

      await service.updateStatus('inq-1', InquiryStatus.OFFER_RECEIVED, consultant);

      expect(loanAppsMock.assertAccessById).toHaveBeenCalledWith(
        'app-1',
        consultant,
      );
      expect(bankInquiry.update).toHaveBeenCalledWith({
        where: { id: 'inq-1' },
        data: { status: InquiryStatus.OFFER_RECEIVED },
      });
    });
  });
});

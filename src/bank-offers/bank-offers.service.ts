import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankOffer, OfferStatus } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { InquiryStatus } from '@prisma/client';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { CompareOffersQueryDto } from './dto/compare-offers-query.dto';
import { CreateBankOfferDto } from './dto/create-bank-offer.dto';
import { UpdateBankOfferDto } from './dto/update-bank-offer.dto';
import {
  ComparisonResult,
  OfferComparisonService,
} from './offer-comparison.service';

@Injectable()
export class BankOffersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly loanApplicationsService: LoanApplicationsService,
    private readonly offerComparisonService: OfferComparisonService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /**
   * Записва получена от банката оферта. Ако е по конкретно запитване,
   * запитването се маркира като OFFER_RECEIVED. Заявката се придвижва
   * SENT_TO_BANKS → OFFERS_RECEIVED (без връщане назад, ако е по-напред).
   */
  async create(
    applicationId: string,
    dto: CreateBankOfferDto,
    currentUser: AuthenticatedUser,
  ): Promise<BankOffer> {
    // Роля, собственост и преход на заявката
    await this.loanApplicationsService.markOffersReceived(
      applicationId,
      currentUser,
    );

    const bank = await this.db.bank.findUnique({ where: { id: dto.bankId } });
    if (!bank) {
      throw new BadRequestException('Bank not found');
    }

    if (dto.inquiryId) {
      const inquiry = await this.db.bankInquiry.findUnique({
        where: { id: dto.inquiryId },
        include: { offer: true },
      });
      if (!inquiry) {
        throw new BadRequestException('Bank inquiry not found');
      }
      if (inquiry.loanApplicationId !== applicationId) {
        throw new BadRequestException(
          'Inquiry belongs to a different loan application',
        );
      }
      if (inquiry.offer) {
        throw new ConflictException(
          'An offer is already recorded for this inquiry',
        );
      }
    }

    const { bankId, inquiryId, ...params } = dto;

    return this.db.$transaction(async (tx) => {
      const offer = await tx.bankOffer.create({
        data: {
          ...params,
          loanApplicationId: applicationId,
          bankId,
          inquiryId,
          status: OfferStatus.PENDING,
        },
      });
      if (inquiryId) {
        await tx.bankInquiry.update({
          where: { id: inquiryId },
          data: { status: InquiryStatus.OFFER_RECEIVED },
        });
      }
      return offer;
    });
  }

  async findAllForApplication(
    applicationId: string,
    currentUser: AuthenticatedUser,
  ): Promise<BankOffer[]> {
    await this.loanApplicationsService.assertAccessById(
      applicationId,
      currentUser,
    );
    return this.db.bankOffer.findMany({
      where: { loanApplicationId: applicationId },
      include: { bank: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Сравнение рамо до рамо — само числа, без класиране (виж note в отговора). */
  async compare(
    applicationId: string,
    query: CompareOffersQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<ComparisonResult> {
    await this.loanApplicationsService.assertAccessById(
      applicationId,
      currentUser,
    );
    const offers = await this.db.bankOffer.findMany({
      where: { loanApplicationId: applicationId },
      include: { bank: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return this.offerComparisonService.compare(offers, query.sortBy);
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<BankOffer> {
    const offer = await this.db.bankOffer.findUnique({
      where: { id },
      include: {
        bank: { select: { id: true, name: true } },
        inquiry: { select: { id: true, sentAt: true, status: true } },
      },
    });
    if (!offer) {
      throw new NotFoundException('Bank offer not found');
    }
    await this.loanApplicationsService.assertAccessById(
      offer.loanApplicationId,
      currentUser,
    );
    return offer;
  }

  async update(
    id: string,
    dto: UpdateBankOfferDto,
    currentUser: AuthenticatedUser,
  ): Promise<BankOffer> {
    await this.findOne(id, currentUser);
    return this.db.bankOffer.update({ where: { id }, data: dto });
  }

  /**
   * Отбелязва избора на клиента: избраната оферта става SELECTED, останалите —
   * REJECTED, а заявката минава в OFFER_SELECTED. Преизбор е позволен (напр.
   * ако банката впоследствие откаже), докато заявката е в подходящ статус.
   */
  async select(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ selected: BankOffer; rejected: number }> {
    const offer = await this.findOne(id, currentUser);
    await this.loanApplicationsService.markOfferSelected(
      offer.loanApplicationId,
      currentUser,
    );

    return this.db.$transaction(async (tx) => {
      const { count } = await tx.bankOffer.updateMany({
        where: {
          loanApplicationId: offer.loanApplicationId,
          id: { not: id },
        },
        data: { status: OfferStatus.REJECTED },
      });
      const selected = await tx.bankOffer.update({
        where: { id },
        data: { status: OfferStatus.SELECTED },
      });
      return { selected, rejected: count };
    });
  }
}

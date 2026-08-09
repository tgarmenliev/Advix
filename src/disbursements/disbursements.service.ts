import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionLoanCategory,
  Disbursement,
  LoanStatus,
  OfferStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { commissionCategoryToLoanTypes } from '../commission-schemes/loan-category.util';
import { CalendarPeriod } from '../commission-schemes/period.util';
import { PrismaService } from '../database/prisma.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { CreateDisbursementDto } from './dto/create-disbursement.dto';
import { UpdateDisbursementDto } from './dto/update-disbursement.dto';

/** Статуси на офертата, при които тя е „действащата" по заявката. */
const ACTIVE_OFFER_STATUSES: readonly OfferStatus[] = [
  OfferStatus.SELECTED,
  OfferStatus.APPLICATION_SUBMITTED,
  OfferStatus.APPROVED,
  OfferStatus.DISBURSED,
];

/** Заявката трябва да е стигнала дотук, за да има реално усвояване. */
const DISBURSABLE_APPLICATION_STATUSES: readonly LoanStatus[] = [
  LoanStatus.APPROVED,
  LoanStatus.DISBURSED,
  LoanStatus.COMPLETED,
];

export interface DisbursementResult {
  disbursement: Disbursement;
  /** Общо усвоено по заявката след този транш (стотинки) */
  totalDisbursed: number;
  warning?: string;
}

@Injectable()
export class DisbursementsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly loanApplicationsService: LoanApplicationsService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /**
   * Записва усвоен транш по избраната оферта на заявката.
   *
   * Тук възниква комисионата — затова датата на усвояване е ключова: тя решава
   * в кой отчетен период попада обемът.
   *
   * Заявката НЕ се придвижва автоматично към DISBURSED: по дефиниция този
   * статус означава „последният транш", а системата не може да знае кой е
   * последният. Консултантът го отбелязва изрично.
   */
  async create(
    applicationId: string,
    dto: CreateDisbursementDto,
    currentUser: AuthenticatedUser,
  ): Promise<DisbursementResult> {
    const application = await this.loadApplication(applicationId, currentUser);

    if (!DISBURSABLE_APPLICATION_STATUSES.includes(application.status)) {
      throw new BadRequestException(
        `Cannot record a disbursement while the application is ${application.status} — ` +
          'the loan must be approved first',
      );
    }

    const offer = await this.findActiveOffer(applicationId);

    const existing = await this.db.disbursement.findMany({
      where: { offerId: offer.id },
      orderBy: { trancheNumber: 'asc' },
    });

    const trancheNumber =
      dto.trancheNumber ??
      existing.reduce((max, d) => Math.max(max, d.trancheNumber), 0) + 1;

    if (existing.some((d) => d.trancheNumber === trancheNumber)) {
      throw new ConflictException(
        `Tranche number ${trancheNumber} already exists for this offer`,
      );
    }

    const disbursement = await this.db.disbursement.create({
      data: {
        offerId: offer.id,
        trancheNumber,
        amount: dto.amount,
        disbursedAt: new Date(dto.disbursedAt),
      },
    });

    const totalDisbursed =
      existing.reduce((sum, d) => sum + d.amount, 0) + dto.amount;

    // Мека проверка: усвоеното над искания размер обикновено е печатна грешка,
    // но одобреният размер може и да се различава — затова само предупреждаваме
    const warning =
      totalDisbursed > application.amount
        ? `Total disbursed (${totalDisbursed}) exceeds the application amount (${application.amount})`
        : undefined;

    return warning
      ? { disbursement, totalDisbursed, warning }
      : { disbursement, totalDisbursed };
  }

  async findAllForApplication(
    applicationId: string,
    currentUser: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(
      applicationId,
      currentUser,
    );
    const offer = await this.findActiveOffer(applicationId);
    const disbursements = await this.db.disbursement.findMany({
      where: { offerId: offer.id },
      include: { commission: true },
      orderBy: { trancheNumber: 'asc' },
    });
    return {
      offerId: offer.id,
      disbursements,
      totalDisbursed: disbursements.reduce((sum, d) => sum + d.amount, 0),
    };
  }

  async update(
    id: string,
    dto: UpdateDisbursementDto,
    currentUser: AuthenticatedUser,
  ): Promise<Disbursement> {
    const disbursement = await this.loadOwned(id, currentUser);
    return this.db.disbursement.update({
      where: { id: disbursement.id },
      data: {
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.trancheNumber !== undefined && {
          trancheNumber: dto.trancheNumber,
        }),
        ...(dto.disbursedAt !== undefined && {
          disbursedAt: new Date(dto.disbursedAt),
        }),
      },
    });
  }

  async remove(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<{ id: string; deleted: true }> {
    const disbursement = await this.loadOwned(id, currentUser);

    const commission = await this.db.trancheCommission.findUnique({
      where: { disbursementId: disbursement.id },
    });
    if (commission) {
      throw new ConflictException(
        'A commission is already recorded for this tranche — remove it first',
      );
    }

    await this.db.disbursement.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * Общият усвоен обем за банка и категория кредити в рамките на период.
   * Това е базата за скалите — потвърдено: обемът се мери по РЕАЛНО усвоените
   * суми, не по договорените.
   */
  async volumeFor(
    bankId: string,
    category: CommissionLoanCategory,
    period: CalendarPeriod,
  ): Promise<number> {
    const result = await this.db.disbursement.aggregate({
      _sum: { amount: true },
      where: {
        disbursedAt: { gte: period.startsAt, lt: period.endsAt },
        offer: {
          bankId,
          loanApplication: {
            loanType: { in: commissionCategoryToLoanTypes(category) },
          },
        },
      },
    });
    return result._sum.amount ?? 0;
  }

  /** Траншовете за банка/категория/период — за преизчисляване на комисиони. */
  async findForPeriod(
    bankId: string,
    category: CommissionLoanCategory,
    period: CalendarPeriod,
  ) {
    return this.db.disbursement.findMany({
      where: {
        disbursedAt: { gte: period.startsAt, lt: period.endsAt },
        offer: {
          bankId,
          loanApplication: {
            loanType: { in: commissionCategoryToLoanTypes(category) },
          },
        },
      },
      include: {
        commission: true,
        offer: { select: { id: true, bankId: true, loanApplicationId: true } },
      },
      orderBy: { disbursedAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------

  private async loadApplication(
    applicationId: string,
    currentUser: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(
      applicationId,
      currentUser,
    );
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    return application;
  }

  /** Действащата (избрана) оферта — само по нея се усвояват траншове. */
  private async findActiveOffer(applicationId: string) {
    const offer = await this.db.bankOffer.findFirst({
      where: {
        loanApplicationId: applicationId,
        status: { in: [...ACTIVE_OFFER_STATUSES] },
      },
    });
    if (!offer) {
      throw new BadRequestException(
        'No selected offer for this application — select an offer first',
      );
    }
    return offer;
  }

  private async loadOwned(id: string, currentUser: AuthenticatedUser) {
    const disbursement = await this.db.disbursement.findUnique({
      where: { id },
      include: { offer: { select: { loanApplicationId: true } } },
    });
    if (!disbursement) {
      throw new NotFoundException('Disbursement not found');
    }
    await this.loanApplicationsService.assertAccessById(
      disbursement.offer.loanApplicationId,
      currentUser,
    );
    return disbursement;
  }
}

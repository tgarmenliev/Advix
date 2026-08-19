import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Client,
  LoanApplication,
  LoanStatus,
  LoanType,
  OfferStatus,
  Prisma,
  RelatedPersonRole,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ageFromEgn } from '../common/validators/egn.util';
import { PrismaService } from '../database/prisma.service';
import { CreateLoanApplicationDto } from './dto/create-loan-application.dto';
import { LinkPropertyDto } from './dto/link-property.dto';
import { ListLoanApplicationsQueryDto } from './dto/list-loan-applications-query.dto';
import { TransitionDto } from './dto/transition.dto';
import { UpdateLoanApplicationDto } from './dto/update-loan-application.dto';
import { WorkflowService } from './workflow/workflow.service';

const PARTNER_ROLES: readonly UserRole[] = [
  UserRole.PARTNER_A,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
];

/** Роли, които могат да бъдат назначени като отговорен консултант по заявка. */
const OPERATOR_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
];

/** Терминални статуси — от тях ADMIN не връща заявка за корекция; и не се
 *  сменя типът на кредита. */
const TERMINAL_STATUSES: readonly LoanStatus[] = [
  LoanStatus.COMPLETED,
  LoanStatus.REJECTED_BY_CLIENT,
];

/** Финализирани статуси — досието е заключено: без промени по съдлъжници и без
 *  flip на роли. (Специфично за тези операции; виж PHASE_04 корекции.) */
const FINALIZED_STATUSES: readonly LoanStatus[] = [
  LoanStatus.DISBURSED,
  LoanStatus.COMPLETED,
];

/**
 * Статусът на избраната оферта следва този на заявката. Само за преходите, при
 * които офертата има съответствие; останалите не пипат офертите.
 */
const OFFER_STATUS_BY_APPLICATION_STATUS: Partial<
  Record<LoanStatus, OfferStatus>
> = {
  [LoanStatus.APPLICATION_SUBMITTED]: OfferStatus.APPLICATION_SUBMITTED,
  [LoanStatus.APPROVED]: OfferStatus.APPROVED,
  [LoanStatus.DISBURSED]: OfferStatus.DISBURSED,
  // Банката отказа — офертата отпада и клиентът може да избере друга
  [LoanStatus.REJECTED_BY_BANK]: OfferStatus.REJECTED,
};

/** Роли, които могат да пишат във вътрешните бележки (internalNotes). */
const NOTES_WRITER_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
];

/** Минимална част от заявката, нужна за проверка на достъп. */
type OwnershipView = Pick<
  LoanApplication,
  'consultantId' | 'partnerId'
>;

/** Ограниченият изглед, който PARTNER_A вижда за своите лийдове. */
export interface PartnerLeadView {
  id: string;
  loanType: LoanType;
  amount: number;
  termMonths: number | null;
  purpose: string | null;
  status: LoanStatus;
  createdAt: Date;
  client: {
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
  };
}

@Injectable()
export class LoanApplicationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly workflowService: WorkflowService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(
    dto: CreateLoanApplicationDto,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const client = await this.db.client.findFirst({
      where: { id: dto.clientId, deletedAt: null },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }

    const { consultantId, partnerId } = this.resolveResponsibleParties(
      dto,
      currentUser,
    );

    return this.db.$transaction(async (tx) => {
      const application = await tx.loanApplication.create({
        data: {
          clientId: dto.clientId,
          consultantId,
          partnerId,
          loanType: dto.loanType,
          amount: dto.amount,
          termMonths: dto.termMonths ?? null,
          purpose: dto.purpose,
          status: LoanStatus.NEW,
        },
      });
      // Началният статус също се записва в историята (fromStatus: null)
      await tx.loanStatusHistory.create({
        data: {
          loanApplicationId: application.id,
          fromStatus: null,
          toStatus: LoanStatus.NEW,
          changedByUserId: currentUser.userId,
        },
      });
      return application;
    });
  }

  async findAll(
    query: ListLoanApplicationsQueryDto,
    currentUser: AuthenticatedUser,
  ) {
    const { page, limit, status, clientId, consultantId } = query;
    // Видимостта по роля се комбинира с явните филтри от заявката
    const where: Prisma.LoanApplicationWhereInput = {
      ...this.visibilityWhere(currentUser),
      ...(status && { status }),
      ...(clientId && { clientId }),
      ...(consultantId && { consultantId }),
    };

    const [data, total] = await Promise.all([
      this.db.loanApplication.findMany({
        where,
        include: { client: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.loanApplication.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication | PartnerLeadView> {
    const application = await this.db.loanApplication.findUnique({
      where: { id },
      include: {
        client: { include: { familyMembers: { where: { deletedAt: null } } } },
        properties: { include: { property: true } },
        familyMembers: { include: { familyMember: true } },
        bankInquiries: true,
        bankOffers: true,
        documents: true,
        statusHistory: { orderBy: { changedAt: 'asc' } },
        businessProfile: true,
      },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    this.assertCanAccess(application, currentUser);

    // PARTNER_A не вижда пълното досие — само базовите данни на своя лийд
    if (currentUser.role === UserRole.PARTNER_A) {
      return this.toPartnerLeadView(application);
    }
    return application;
  }

  async update(
    id: string,
    dto: UpdateLoanApplicationDto,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const existing = await this.loadOwned(id, currentUser);

    // Вътрешните бележки не са за PARTNER_A (има само ограничен изглед);
    // CLIENT изобщо не стига дотук (изключен на ниво guard)
    if (
      dto.internalNotes !== undefined &&
      !NOTES_WRITER_ROLES.includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Your role is not allowed to write internal notes',
      );
    }

    return this.db.loanApplication.update({
      where: { id: existing.id },
      data: dto,
    });
  }

  /**
   * Смяна на типа на заявката — рядък краен случай. Само ADMIN (гарантирано от
   * @Roles на endpoint-а) и само докато заявката не е в терминален статус.
   * Свързаните данни (имот, бизнес профил) НЕ се пипат автоматично — консултантът
   * донагласява ръчно след смяната.
   */
  async changeLoanType(
    id: string,
    loanType: LoanType,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    void currentUser; // достъпът е ограничен до ADMIN на ниво контролер
    const application = await this.db.loanApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    if (TERMINAL_STATUSES.includes(application.status)) {
      throw new BadRequestException(
        'Cannot change the loan type of a finalized application',
      );
    }
    return this.db.loanApplication.update({
      where: { id },
      data: { loanType },
    });
  }

  /**
   * Назначава/прехвърля отговорния консултант (само ADMIN).
   * Покрива два случая от MASTER_CONTEXT: одобряване на лийд от PARTNER_A и
   * прехвърляне на заявка между служители.
   */
  async assignConsultant(
    id: string,
    consultantId: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const application = await this.db.loanApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

    // Потребителят живее в public schema; трябва да е от същия tenant, активен
    // и с роля, която може да оперира заявки (не PARTNER_A, не CLIENT)
    const user = await this.prismaService.publicDb.user.findFirst({
      where: { id: consultantId, tenantId: currentUser.tenantId },
    });
    if (!user || !user.isActive) {
      throw new BadRequestException('Assigned user not found in this tenant');
    }
    if (!OPERATOR_ROLES.includes(user.role)) {
      throw new BadRequestException(
        `Role ${user.role} cannot be assigned as the responsible consultant`,
      );
    }

    return this.db.loanApplication.update({
      where: { id },
      data: { consultantId },
    });
  }

  /**
   * Смяна на статус през WorkflowService + права по роля +
   * задължителна валидация преди READY_FOR_BANK. Всеки преход се записва
   * в LoanStatusHistory.
   */
  async transition(
    id: string,
    dto: TransitionDto,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    this.assertRoleCanTransition(currentUser, dto.toStatus);

    const application = await this.db.loanApplication.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    this.assertCanAccess(application, currentUser);

    // ADMIN може да връща заявка за корекция (→ COLLECTING_INFO) от всеки
    // нетерминален статус — извън обичайните преходи на state machine-а
    const isAdminReturnForCorrection =
      currentUser.role === UserRole.ADMIN &&
      dto.toStatus === LoanStatus.COLLECTING_INFO &&
      application.status !== LoanStatus.COLLECTING_INFO &&
      !TERMINAL_STATUSES.includes(application.status);

    if (!isAdminReturnForCorrection) {
      this.workflowService.assertTransition(application.status, dto.toStatus);
    }

    if (dto.toStatus === LoanStatus.READY_FOR_BANK) {
      this.assertReadyForBank(application, application.client);
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.loanApplication.update({
        where: { id },
        data: { status: dto.toStatus },
      });
      await tx.loanStatusHistory.create({
        data: {
          loanApplicationId: id,
          fromStatus: application.status,
          toStatus: dto.toStatus,
          changedByUserId: currentUser.userId,
          note: dto.note,
        },
      });

      // Избраната оферта следва статуса на заявката (кандидатстване, одобрение,
      // отпускане, отказ от банката). Неизбраните (PENDING/REJECTED) не се пипат.
      const offerStatus = OFFER_STATUS_BY_APPLICATION_STATUS[dto.toStatus];
      if (offerStatus) {
        await tx.bankOffer.updateMany({
          where: {
            loanApplicationId: id,
            status: { notIn: [OfferStatus.PENDING, OfferStatus.REJECTED] },
          },
          data: { status: offerStatus },
        });
      }

      return updated;
    });
  }

  /**
   * Придвижва заявката към SENT_TO_BANKS при изпращане на банкови запитвания.
   * Прилага правилата по роля за изпращане към банки (PARTNER_A не може;
   * PARTNER_B изисква одобрение от ADMIN) и записва прехода в историята.
   * Ако вече е SENT_TO_BANKS → добавяме още запитвания без нов преход.
   * Извиква се от банковия модул (BankInquiriesService).
   */
  async markSentToBanks(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    this.assertRoleCanTransition(currentUser, LoanStatus.SENT_TO_BANKS);
    const application = await this.loadOwned(id, currentUser);

    if (application.status === LoanStatus.SENT_TO_BANKS) {
      return application;
    }
    if (
      application.status !== LoanStatus.READY_FOR_BANK &&
      application.status !== LoanStatus.REJECTED_BY_BANK
    ) {
      throw new BadRequestException(
        `Cannot send to banks from status ${application.status}`,
      );
    }

    const [updated] = await this.db.$transaction([
      this.db.loanApplication.update({
        where: { id },
        data: { status: LoanStatus.SENT_TO_BANKS },
      }),
      this.db.loanStatusHistory.create({
        data: {
          loanApplicationId: id,
          fromStatus: application.status,
          toStatus: LoanStatus.SENT_TO_BANKS,
          changedByUserId: currentUser.userId,
          note: 'Изпратени банкови запитвания',
        },
      }),
    ]);
    return updated;
  }

  /**
   * Извиква се при записване на банкова оферта: придвижва заявката
   * SENT_TO_BANKS → OFFERS_RECEIVED. Ако заявката вече е по-напред (напр. при
   * закъсняла оферта), статусът НЕ се връща назад — просто не се пипа.
   */
  async markOffersReceived(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const application = await this.loadOwned(id, currentUser);
    if (
      FINALIZED_STATUSES.includes(application.status) ||
      application.status === LoanStatus.REJECTED_BY_CLIENT
    ) {
      throw new BadRequestException(
        'Cannot record offers for a closed application',
      );
    }
    if (application.status !== LoanStatus.SENT_TO_BANKS) {
      return application;
    }
    const [updated] = await this.db.$transaction([
      this.db.loanApplication.update({
        where: { id },
        data: { status: LoanStatus.OFFERS_RECEIVED },
      }),
      this.db.loanStatusHistory.create({
        data: {
          loanApplicationId: id,
          fromStatus: application.status,
          toStatus: LoanStatus.OFFERS_RECEIVED,
          changedByUserId: currentUser.userId,
          note: 'Получена банкова оферта',
        },
      }),
    ]);
    return updated;
  }

  /**
   * Извиква се при избор на оферта: OFFERS_RECEIVED → OFFER_SELECTED.
   * Преизбор (когато заявката вече е OFFER_SELECTED) е позволен и не създава
   * нов преход.
   */
  async markOfferSelected(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const application = await this.loadOwned(id, currentUser);
    return this.transitionToOfferSelected(
      application,
      currentUser.userId,
      'Избрана оферта',
    );
  }

  /**
   * Използва се от Secure Link потока — клиентът избира сам, без JWT
   * потребител. Собствеността вече е проверена от SecureLinksService срещу
   * link-а (loanApplicationId), не срещу ролево видимо досие.
   */
  async markOfferSelectedForSecureLink(
    applicationId: string,
  ): Promise<LoanApplication> {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    return this.transitionToOfferSelected(
      application,
      null,
      'Избрана оферта (клиентски достъп през Secure Link)',
    );
  }

  private async transitionToOfferSelected(
    application: LoanApplication,
    changedByUserId: string | null,
    note: string,
  ): Promise<LoanApplication> {
    if (application.status === LoanStatus.OFFER_SELECTED) {
      return application;
    }
    if (application.status !== LoanStatus.OFFERS_RECEIVED) {
      throw new BadRequestException(
        `Cannot select an offer from status ${application.status}`,
      );
    }
    const [updated] = await this.db.$transaction([
      this.db.loanApplication.update({
        where: { id: application.id },
        data: { status: LoanStatus.OFFER_SELECTED },
      }),
      this.db.loanStatusHistory.create({
        data: {
          loanApplicationId: application.id,
          fromStatus: application.status,
          toStatus: LoanStatus.OFFER_SELECTED,
          changedByUserId,
          note,
        },
      }),
    ]);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Свързани лица по заявката (junction LoanApplicationFamilyMember)
  // ---------------------------------------------------------------------------

  /**
   * Включва свързано лице в заявката. Лицето ТРЯБВА да принадлежи на клиента
   * на заявката — не може съдлъжник на друг клиент да влезе в чуждо досие.
   */
  async addFamilyMember(
    applicationId: string,
    familyMemberId: string,
    currentUser: AuthenticatedUser,
  ) {
    const application = await this.loadOwned(applicationId, currentUser);
    // Съдлъжници се управляват само докато досието не е финализирано
    this.assertNotFinalized(application.status);

    const member = await this.db.familyMember.findFirst({
      where: { id: familyMemberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('Family member not found');
    }

    if (member.clientId !== application.clientId) {
      throw new BadRequestException(
        'Family member belongs to a different client than this application',
      );
    }

    const existing = await this.db.loanApplicationFamilyMember.findUnique({
      where: {
        loanApplicationId_familyMemberId: {
          loanApplicationId: applicationId,
          familyMemberId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Family member is already included in this application',
      );
    }

    return this.db.loanApplicationFamilyMember.create({
      data: { loanApplicationId: applicationId, familyMemberId },
      include: { familyMember: true },
    });
  }

  async removeFamilyMember(
    applicationId: string,
    familyMemberId: string,
    currentUser: AuthenticatedUser,
  ) {
    const application = await this.loadOwned(applicationId, currentUser);
    this.assertNotFinalized(application.status);
    const link = await this.db.loanApplicationFamilyMember.findUnique({
      where: {
        loanApplicationId_familyMemberId: {
          loanApplicationId: applicationId,
          familyMemberId,
        },
      },
    });
    if (!link) {
      throw new NotFoundException(
        'Family member is not included in this application',
      );
    }
    await this.db.loanApplicationFamilyMember.delete({
      where: {
        loanApplicationId_familyMemberId: {
          loanApplicationId: applicationId,
          familyMemberId,
        },
      },
    });
    return { loanApplicationId: applicationId, familyMemberId, removed: true };
  }

  async listFamilyMembers(
    applicationId: string,
    currentUser: AuthenticatedUser,
  ) {
    await this.loadOwned(applicationId, currentUser);
    const links = await this.db.loanApplicationFamilyMember.findMany({
      where: {
        loanApplicationId: applicationId,
        familyMember: { deletedAt: null },
      },
      include: { familyMember: true },
      orderBy: { assignedAt: 'asc' },
    });
    return links.map((link) => ({
      assignedAt: link.assignedAt,
      ...link.familyMember,
    }));
  }

  /**
   * Разменя основния кредитоискател с включен съдлъжник: подаденият
   * familyMember става основен клиент на заявката, а досегашният клиент —
   * съдлъжник.
   *
   * Подход (Client и FamilyMember са различни таблици):
   *  - Промоция: намираме Client по ЕГН на съдлъжника (Client.egn е @unique);
   *    ако не съществува — създаваме го от данните на съдлъжника. Ако е soft-
   *    deleted — възстановяваме го. Така НЕ дублираме човек по ЕГН.
   *  - Демоция: старият клиент става FamilyMember под новия клиент; дедуп по
   *    (clientId, egn), за да не се дублира при повторен flip.
   *  - Разменяме junction връзките и пренасочваме application.clientId.
   * Операцията е в една транзакция и е обратима (повторен flip с новия съдлъжник
   * връща изходното състояние, преизползвайки вече съществуващите записи).
   */
  async flipBorrower(
    applicationId: string,
    familyMemberId: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const application = await this.loadOwned(applicationId, currentUser);
    this.assertNotFinalized(application.status);

    // Flip е позволен само за лице, което Е включено в заявката
    const link = await this.db.loanApplicationFamilyMember.findUnique({
      where: {
        loanApplicationId_familyMemberId: {
          loanApplicationId: applicationId,
          familyMemberId,
        },
      },
    });
    if (!link) {
      throw new BadRequestException(
        'Family member is not included in this application',
      );
    }

    const member = await this.db.familyMember.findFirst({
      where: { id: familyMemberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('Family member not found');
    }

    const oldClient = await this.db.client.findFirst({
      where: { id: application.clientId, deletedAt: null },
    });
    if (!oldClient) {
      throw new NotFoundException('Current client not found');
    }
    // За да стане съдлъжник, старият клиент трябва да е идентифициран с ЕГН
    if (!oldClient.egn) {
      throw new BadRequestException(
        'Current client must have an EGN before it can become a co-borrower',
      );
    }
    const oldClientEgn = oldClient.egn;

    return this.db.$transaction(async (tx) => {
      // 1. Промоция на съдлъжника до Client (дедуп по ЕГН)
      const existingClient = await tx.client.findUnique({
        where: { egn: member.egn },
      });
      let newClient: Client;
      if (existingClient) {
        newClient = existingClient.deletedAt
          ? await tx.client.update({
              where: { id: existingClient.id },
              data: { deletedAt: null },
            })
          : existingClient;
      } else {
        newClient = await tx.client.create({
          data: {
            firstName: member.firstName,
            lastName: member.lastName,
            egn: member.egn,
            age: member.age,
            email: member.email,
            phone: member.phone,
            employer: member.employer,
            jobTitle: member.jobTitle,
            contractType: member.contractType,
            netSalary: member.netSalary,
            existingLoansTotal: member.existingLoansTotal,
            existingLoansMonthlyTotal: member.existingLoansMonthlyTotal,
            gdprConsentAt: member.gdprConsentAt,
            gdprDocumentId: member.gdprDocumentId,
          },
        });
      }

      // 2. Демоция на стария клиент до съдлъжник под новия клиент (дедуп)
      const existingDemoted = await tx.familyMember.findFirst({
        where: {
          clientId: newClient.id,
          egn: oldClientEgn,
          deletedAt: null,
        },
      });
      const demoted =
        existingDemoted ??
        (await tx.familyMember.create({
          data: {
            clientId: newClient.id,
            role: RelatedPersonRole.CO_BORROWER,
            firstName: oldClient.firstName,
            lastName: oldClient.lastName ?? '',
            egn: oldClientEgn,
            age: oldClient.age ?? ageFromEgn(oldClientEgn)!,
            email: oldClient.email,
            phone: oldClient.phone,
            employer: oldClient.employer,
            jobTitle: oldClient.jobTitle,
            contractType: oldClient.contractType,
            netSalary: oldClient.netSalary,
            existingLoansTotal: oldClient.existingLoansTotal,
            existingLoansMonthlyTotal: oldClient.existingLoansMonthlyTotal,
            gdprConsentAt: oldClient.gdprConsentAt,
            gdprDocumentId: oldClient.gdprDocumentId,
          },
        }));

      // 3. Размяна на junction връзките
      await tx.loanApplicationFamilyMember.delete({
        where: {
          loanApplicationId_familyMemberId: {
            loanApplicationId: applicationId,
            familyMemberId,
          },
        },
      });
      const demotedLink = await tx.loanApplicationFamilyMember.findUnique({
        where: {
          loanApplicationId_familyMemberId: {
            loanApplicationId: applicationId,
            familyMemberId: demoted.id,
          },
        },
      });
      if (!demotedLink) {
        await tx.loanApplicationFamilyMember.create({
          data: { loanApplicationId: applicationId, familyMemberId: demoted.id },
        });
      }

      // 4. Пренасочваме заявката към новия основен клиент
      return tx.loanApplication.update({
        where: { id: applicationId },
        data: { clientId: newClient.id },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Имоти по заявката (junction LoanApplicationProperty)
  // ---------------------------------------------------------------------------

  /**
   * Свързва имот към заявка. Junction записът пази marketValue и mortgageBankId —
   * те са специфични за връзката, не за самия имот.
   *
   * Мека валидация по тип кредит: при CONSUMER имотът е необичаен → warning в
   * отговора, без блокиране (бизнес кредит може да ползва имот като обезпечение).
   */
  async linkProperty(
    applicationId: string,
    dto: LinkPropertyDto,
    currentUser: AuthenticatedUser,
  ) {
    const application = await this.loadOwned(applicationId, currentUser);

    const property = await this.db.property.findUnique({
      where: { id: dto.propertyId },
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (dto.mortgageBankId) {
      const bank = await this.db.bank.findUnique({
        where: { id: dto.mortgageBankId },
      });
      if (!bank) {
        throw new BadRequestException('Mortgage bank not found');
      }
    }

    const existing = await this.db.loanApplicationProperty.findUnique({
      where: {
        loanApplicationId_propertyId: {
          loanApplicationId: applicationId,
          propertyId: dto.propertyId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Property is already linked to this application',
      );
    }

    const link = await this.db.loanApplicationProperty.create({
      data: {
        loanApplicationId: applicationId,
        propertyId: dto.propertyId,
        marketValue: dto.marketValue,
        mortgageBankId: dto.mortgageBankId,
      },
      include: { property: true },
    });

    const warning =
      application.loanType === LoanType.CONSUMER
        ? 'Property linked to a CONSUMER loan — properties are typically used for mortgage or business collateral'
        : undefined;

    return warning ? { ...link, warning } : link;
  }

  async unlinkProperty(
    applicationId: string,
    propertyId: string,
    currentUser: AuthenticatedUser,
  ) {
    await this.loadOwned(applicationId, currentUser);
    const link = await this.db.loanApplicationProperty.findUnique({
      where: {
        loanApplicationId_propertyId: {
          loanApplicationId: applicationId,
          propertyId,
        },
      },
    });
    if (!link) {
      throw new NotFoundException(
        'Property is not linked to this application',
      );
    }
    await this.db.loanApplicationProperty.delete({ where: { id: link.id } });
    return { loanApplicationId: applicationId, propertyId, removed: true };
  }

  async listProperties(applicationId: string, currentUser: AuthenticatedUser) {
    await this.loadOwned(applicationId, currentUser);
    return this.db.loanApplicationProperty.findMany({
      where: { loanApplicationId: applicationId },
      include: { property: true },
      orderBy: { assignedAt: 'asc' },
    });
  }

  /** Проверява достъп до заявка по id (за операции извън този service). */
  async assertAccessById(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.loadOwned(id, currentUser);
  }

  // ---------------------------------------------------------------------------
  // Помощни (видимост, права, валидация)
  // ---------------------------------------------------------------------------

  /** WHERE клауза, ограничаваща списъка според ролята. */
  private visibilityWhere(
    currentUser: AuthenticatedUser,
  ): Prisma.LoanApplicationWhereInput {
    switch (currentUser.role) {
      case UserRole.ADMIN:
        return {}; // вижда всички в своя tenant
      case UserRole.CONSULTANT:
        return { consultantId: currentUser.userId };
      default:
        // PARTNER_A/B/C виждат само заявките, които са въвели
        return { partnerId: currentUser.userId };
    }
  }

  /** Хвърля ForbiddenException, ако потребителят няма достъп до заявката. */
  private assertCanAccess(
    application: OwnershipView,
    currentUser: AuthenticatedUser,
  ): void {
    if (currentUser.role === UserRole.ADMIN) {
      return;
    }
    if (
      currentUser.role === UserRole.CONSULTANT &&
      application.consultantId === currentUser.userId
    ) {
      return;
    }
    if (
      PARTNER_ROLES.includes(currentUser.role) &&
      application.partnerId === currentUser.userId
    ) {
      return;
    }
    throw new ForbiddenException(
      'You do not have access to this loan application',
    );
  }

  /** Блокира промени, ако досието е финализирано (DISBURSED/COMPLETED). */
  private assertNotFinalized(status: LoanStatus): void {
    if (FINALIZED_STATUSES.includes(status)) {
      throw new BadRequestException(
        'The application is finalized — co-borrowers and borrower roles are locked',
      );
    }
  }

  /** Зарежда заявка и проверява достъп — за мутиращи операции. */
  private async loadOwned(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<LoanApplication> {
    const application = await this.db.loanApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    this.assertCanAccess(application, currentUser);
    return application;
  }

  /** Определя consultantId/partnerId при създаване според ролята. */
  private resolveResponsibleParties(
    dto: CreateLoanApplicationDto,
    currentUser: AuthenticatedUser,
  ): { consultantId: string | null; partnerId: string | null } {
    if (currentUser.role === UserRole.ADMIN) {
      return {
        consultantId: dto.consultantId ?? currentUser.userId,
        partnerId: dto.partnerId ?? null,
      };
    }
    if (currentUser.role === UserRole.CONSULTANT) {
      return {
        consultantId: currentUser.userId,
        partnerId: dto.partnerId ?? null,
      };
    }
    // PARTNER_A/B/C — сделка/лийд от партньор; консултант се назначава от ADMIN
    return { consultantId: null, partnerId: currentUser.userId };
  }

  private toPartnerLeadView(
    application: LoanApplication & {
      client: Pick<Client, 'id' | 'firstName' | 'lastName' | 'phone'>;
    },
  ): PartnerLeadView {
    return {
      id: application.id,
      loanType: application.loanType,
      amount: application.amount,
      termMonths: application.termMonths,
      purpose: application.purpose,
      status: application.status,
      createdAt: application.createdAt,
      client: {
        id: application.client.id,
        firstName: application.client.firstName,
        lastName: application.client.lastName,
        phone: application.client.phone,
      },
    };
  }

  /** Права по роля (MASTER_CONTEXT §2 и §5). */
  private assertRoleCanTransition(
    currentUser: AuthenticatedUser,
    toStatus: LoanStatus,
  ): void {
    // CLIENT не сменя бизнес статуси — само попълва данни през Secure Links
    if (currentUser.role === UserRole.CLIENT) {
      throw new ForbiddenException(
        'Clients cannot change application status',
      );
    }

    if (toStatus === LoanStatus.SENT_TO_BANKS) {
      // PARTNER_A изобщо не изпраща към банки
      if (currentUser.role === UserRole.PARTNER_A) {
        throw new ForbiddenException('Partners (model A) cannot send to banks');
      }
      // PARTNER_B изисква одобрение от ADMIN — механизмът за одобрение идва
      // в следваща фаза, затова засега преходът е забранен
      if (currentUser.role === UserRole.PARTNER_B) {
        throw new ForbiddenException(
          'Sending to banks requires ADMIN approval for partner model B',
        );
      }
    }
  }

  /** Задължителна валидация преди READY_FOR_BANK (MASTER_CONTEXT §3). */
  private assertReadyForBank(
    application: LoanApplication,
    client: Client,
  ): void {
    const missing = this.getMissingReadyForBankFields(application, client);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Missing required fields for READY_FOR_BANK',
        missingFields: missing,
      });
    }
  }

  /**
   * Кои задължителни полета липсват преди READY_FOR_BANK — без да хвърля.
   * Преизползва се и от Secure Link "какво остава да попълни клиентът" изгледа,
   * за да няма два различни списъка с изисквания, които могат да се разминат.
   */
  getMissingReadyForBankFields(
    application: Pick<LoanApplication, 'amount' | 'termMonths'>,
    client: Pick<Client, 'egn' | 'netSalary' | 'contractType' | 'gdprConsentAt'>,
  ): string[] {
    const missing: string[] = [];
    if (!client.egn) missing.push('client.egn');
    if (client.netSalary == null) missing.push('client.netSalary');
    if (!client.contractType) missing.push('client.contractType');
    if (!client.gdprConsentAt) missing.push('client.gdprConsentAt');
    if (application.amount == null) missing.push('loanApplication.amount');
    if (application.termMonths == null) {
      missing.push('loanApplication.termMonths');
    }
    return missing;
  }
}

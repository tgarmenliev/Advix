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
  Prisma,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
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

    // CONSULTANT/PARTNER_B/PARTNER_C водят заявката на свое име;
    // ADMIN може да назначи консултант изрично
    const isPartner = PARTNER_ROLES.includes(currentUser.role);
    const consultantId =
      currentUser.role === UserRole.ADMIN
        ? (dto.consultantId ?? currentUser.userId)
        : currentUser.userId;
    const partnerId = dto.partnerId ?? (isPartner ? currentUser.userId : null);

    return this.db.$transaction(async (tx) => {
      const application = await tx.loanApplication.create({
        data: {
          clientId: dto.clientId,
          consultantId,
          partnerId,
          loanType: dto.loanType,
          amount: dto.amount,
          termMonths: dto.termMonths,
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

  async findAll(query: ListLoanApplicationsQueryDto) {
    const { page, limit, status, clientId, consultantId } = query;
    const where: Prisma.LoanApplicationWhereInput = {
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

  async findOne(id: string): Promise<LoanApplication> {
    // consultant/partner са в public schema — не се include-ват оттук
    const application = await this.db.loanApplication.findUnique({
      where: { id },
      include: {
        client: { include: { familyMembers: true } },
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
    return application;
  }

  async update(
    id: string,
    dto: UpdateLoanApplicationDto,
  ): Promise<LoanApplication> {
    const existing = await this.db.loanApplication.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Loan application not found');
    }
    return this.db.loanApplication.update({ where: { id }, data: dto });
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

    this.workflowService.assertTransition(application.status, dto.toStatus);

    if (dto.toStatus === LoanStatus.READY_FOR_BANK) {
      this.assertReadyForBank(application, application.client);
    }

    const [updated] = await this.db.$transaction([
      this.db.loanApplication.update({
        where: { id },
        data: { status: dto.toStatus },
      }),
      this.db.loanStatusHistory.create({
        data: {
          loanApplicationId: id,
          fromStatus: application.status,
          toStatus: dto.toStatus,
          changedByUserId: currentUser.userId,
          note: dto.note,
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
  async addFamilyMember(applicationId: string, familyMemberId: string) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

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

  async removeFamilyMember(applicationId: string, familyMemberId: string) {
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

  async listFamilyMembers(applicationId: string) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
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
  async linkProperty(applicationId: string, dto: LinkPropertyDto) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

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

  async unlinkProperty(applicationId: string, propertyId: string) {
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

  async listProperties(applicationId: string) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    return this.db.loanApplicationProperty.findMany({
      where: { loanApplicationId: applicationId },
      include: { property: true },
      orderBy: { assignedAt: 'asc' },
    });
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
    const missing: string[] = [];
    if (!client.egn) missing.push('client.egn');
    if (client.netSalary == null) missing.push('client.netSalary');
    if (!client.contractType) missing.push('client.contractType');
    if (!client.gdprConsentAt) missing.push('client.gdprConsentAt');
    if (application.amount == null) missing.push('loanApplication.amount');
    if (application.termMonths == null) {
      missing.push('loanApplication.termMonths');
    }

    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Missing required fields for READY_FOR_BANK',
        missingFields: missing,
      });
    }
  }
}

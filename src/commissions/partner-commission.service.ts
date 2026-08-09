import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionRecord,
  PartnerCommissionModel,
  PartnerCommissionStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { ProposePartnerCommissionDto } from './dto/propose-partner-commission.dto';

/** Числата, върху които се смята делът на партньора (стотинки). */
export interface PartnerCommissionBasis {
  totalDisbursed: number;
  expectedCommission: number;
  receivedCommission: number;
}

export interface PartnerCommissionView {
  loanApplicationId: string;
  partnerId: string | null;
  model: PartnerCommissionModel | null;
  percent: number | null;
  fixed: number | null;
  /** Изчислената дължима сума при текущите данни */
  computedAmount: number | null;
  /** Сумата, замразена при одобрението */
  approvedAmount: number | null;
  status: PartnerCommissionStatus | null;
  basis: PartnerCommissionBasis;
  /** Комисиона от банката минус дела на партньора */
  netRevenue: number;
}

/** Статуси, от които предложението още може да се променя. */
const EDITABLE_STATUSES: readonly PartnerCommissionStatus[] = [
  PartnerCommissionStatus.PROPOSED,
  PartnerCommissionStatus.REJECTED,
];

@Injectable()
export class PartnerCommissionService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /**
   * Изчислява дължимото на партньора по договорения модел.
   *
   * При „процент от комисионата" базата е реално ПОЛУЧЕНОТО от банката, ако
   * вече има постъпления; докато няма, се ползва очакваното като прогноза.
   */
  computeAmount(
    model: PartnerCommissionModel,
    percent: number | null,
    fixed: number | null,
    basis: PartnerCommissionBasis,
  ): number {
    switch (model) {
      case PartnerCommissionModel.FIXED:
        return fixed ?? 0;
      case PartnerCommissionModel.PERCENT_OF_LOAN:
        return Math.round(basis.totalDisbursed * (percent ?? 0));
      case PartnerCommissionModel.PERCENT_OF_COMMISSION: {
        const source =
          basis.receivedCommission > 0
            ? basis.receivedCommission
            : basis.expectedCommission;
        return Math.round(source * (percent ?? 0));
      }
    }
  }

  /**
   * Предложение за дял на партньора. Партньорът може да си го въведе сам,
   * консултантът също; ADMIN одобрява. Когато ADMIN въвежда, предложението е
   * одобрено веднага — той е одобряващият.
   */
  async propose(
    loanApplicationId: string,
    dto: ProposePartnerCommissionDto,
    currentUser: AuthenticatedUser,
  ): Promise<PartnerCommissionView> {
    this.assertModelShape(dto);

    const application = await this.db.loanApplication.findUnique({
      where: { id: loanApplicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    if (!application.partnerId) {
      throw new BadRequestException(
        'This application has no partner — there is no partner commission to agree on',
      );
    }

    const record = await this.ensureRecord(loanApplicationId);
    if (
      record.partnerCommissionStatus &&
      !EDITABLE_STATUSES.includes(record.partnerCommissionStatus)
    ) {
      throw new BadRequestException(
        `The partner commission is already ${record.partnerCommissionStatus} and cannot be changed`,
      );
    }

    const isAdmin = currentUser.role === UserRole.ADMIN;
    const basis = await this.loadBasis(loanApplicationId);
    const amount = this.computeAmount(
      dto.model,
      dto.percent ?? null,
      dto.fixed ?? null,
      basis,
    );

    await this.db.commissionRecord.update({
      where: { id: record.id },
      data: {
        partnerId: application.partnerId,
        partnerCommissionModel: dto.model,
        partnerCommissionPercent: dto.percent ?? null,
        partnerCommissionFixed: dto.fixed ?? null,
        partnerCommissionProposedById: currentUser.userId,
        ...(isAdmin
          ? {
              partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
              partnerCommissionAmount: amount,
              partnerCommissionApprovedById: currentUser.userId,
              partnerCommissionApprovedAt: new Date(),
            }
          : {
              partnerCommissionStatus: PartnerCommissionStatus.PROPOSED,
              partnerCommissionAmount: null,
              partnerCommissionApprovedById: null,
              partnerCommissionApprovedAt: null,
            }),
      },
    });

    return this.findForApplication(loanApplicationId);
  }

  /** Одобрение от ADMIN — замразява дължимата сума към този момент. */
  async approve(
    loanApplicationId: string,
    currentUser: AuthenticatedUser,
  ): Promise<PartnerCommissionView> {
    const record = await this.loadRecordWithProposal(loanApplicationId);
    if (record.partnerCommissionStatus !== PartnerCommissionStatus.PROPOSED) {
      throw new BadRequestException(
        `Only a proposed partner commission can be approved (current: ${record.partnerCommissionStatus})`,
      );
    }

    const basis = await this.loadBasis(loanApplicationId);
    const amount = this.computeAmount(
      record.partnerCommissionModel!,
      record.partnerCommissionPercent,
      record.partnerCommissionFixed,
      basis,
    );

    await this.db.commissionRecord.update({
      where: { id: record.id },
      data: {
        partnerCommissionStatus: PartnerCommissionStatus.APPROVED,
        partnerCommissionAmount: amount,
        partnerCommissionApprovedById: currentUser.userId,
        partnerCommissionApprovedAt: new Date(),
      },
    });

    return this.findForApplication(loanApplicationId);
  }

  async reject(loanApplicationId: string): Promise<PartnerCommissionView> {
    const record = await this.loadRecordWithProposal(loanApplicationId);
    if (record.partnerCommissionStatus !== PartnerCommissionStatus.PROPOSED) {
      throw new BadRequestException(
        'Only a proposed partner commission can be rejected',
      );
    }
    await this.db.commissionRecord.update({
      where: { id: record.id },
      data: {
        partnerCommissionStatus: PartnerCommissionStatus.REJECTED,
        partnerCommissionAmount: null,
      },
    });
    return this.findForApplication(loanApplicationId);
  }

  /** Изплащане — става, след като банката е платила на посредника. */
  async pay(loanApplicationId: string): Promise<PartnerCommissionView> {
    const record = await this.loadRecordWithProposal(loanApplicationId);
    if (record.partnerCommissionStatus !== PartnerCommissionStatus.APPROVED) {
      throw new BadRequestException(
        'Only an approved partner commission can be paid',
      );
    }

    const basis = await this.loadBasis(loanApplicationId);
    if (basis.receivedCommission === 0) {
      throw new BadRequestException(
        'No commission received from the bank yet — the partner is paid once the bank pays',
      );
    }

    await this.db.commissionRecord.update({
      where: { id: record.id },
      data: {
        partnerCommissionStatus: PartnerCommissionStatus.PAID,
        partnerCommissionPaidAt: new Date(),
        netRevenue:
          basis.receivedCommission - (record.partnerCommissionAmount ?? 0),
      },
    });

    return this.findForApplication(loanApplicationId);
  }

  /**
   * Преизчислява дължимото по текущите данни. Нужно е, защото обемът и с него
   * процентът от банката се менят със задна дата.
   */
  async recalculate(
    loanApplicationId: string,
  ): Promise<PartnerCommissionView> {
    const record = await this.loadRecordWithProposal(loanApplicationId);
    if (record.partnerCommissionStatus === PartnerCommissionStatus.PAID) {
      throw new BadRequestException(
        'The partner commission is already paid — record an adjustment instead',
      );
    }

    const basis = await this.loadBasis(loanApplicationId);
    const amount = this.computeAmount(
      record.partnerCommissionModel!,
      record.partnerCommissionPercent,
      record.partnerCommissionFixed,
      basis,
    );

    // Замразената сума се обновява само ако вече е одобрена
    if (record.partnerCommissionStatus === PartnerCommissionStatus.APPROVED) {
      await this.db.commissionRecord.update({
        where: { id: record.id },
        data: { partnerCommissionAmount: amount },
      });
    }

    return this.findForApplication(loanApplicationId);
  }

  async findForApplication(
    loanApplicationId: string,
  ): Promise<PartnerCommissionView> {
    const record = await this.db.commissionRecord.findUnique({
      where: { loanApplicationId },
    });
    const basis = await this.loadBasis(loanApplicationId);

    const computedAmount =
      record?.partnerCommissionModel != null
        ? this.computeAmount(
            record.partnerCommissionModel,
            record.partnerCommissionPercent,
            record.partnerCommissionFixed,
            basis,
          )
        : null;

    const partnerShare =
      record?.partnerCommissionStatus === PartnerCommissionStatus.PAID ||
      record?.partnerCommissionStatus === PartnerCommissionStatus.APPROVED
        ? (record.partnerCommissionAmount ?? 0)
        : 0;

    return {
      loanApplicationId,
      partnerId: record?.partnerId ?? null,
      model: record?.partnerCommissionModel ?? null,
      percent: record?.partnerCommissionPercent ?? null,
      fixed: record?.partnerCommissionFixed ?? null,
      computedAmount,
      approvedAmount: record?.partnerCommissionAmount ?? null,
      status: record?.partnerCommissionStatus ?? null,
      basis,
      netRevenue: basis.receivedCommission - partnerShare,
    };
  }

  // ---------------------------------------------------------------------------

  private assertModelShape(dto: ProposePartnerCommissionDto): void {
    if (dto.model === PartnerCommissionModel.FIXED) {
      if (dto.fixed == null) {
        throw new BadRequestException('fixed is required for the FIXED model');
      }
      if (dto.percent != null) {
        throw new BadRequestException('percent is not used by the FIXED model');
      }
      return;
    }
    if (dto.percent == null) {
      throw new BadRequestException(`percent is required for ${dto.model}`);
    }
    if (dto.fixed != null) {
      throw new BadRequestException(`fixed is not used by ${dto.model}`);
    }
  }

  /** Сумите, върху които стъпва изчислението. */
  private async loadBasis(
    loanApplicationId: string,
  ): Promise<PartnerCommissionBasis> {
    const [disbursed, commissions] = await Promise.all([
      this.db.disbursement.aggregate({
        _sum: { amount: true },
        where: { offer: { loanApplicationId } },
      }),
      this.db.trancheCommission.findMany({
        where: { commissionRecord: { loanApplicationId } },
        select: { expectedAmount: true, actualAmount: true },
      }),
    ]);

    return {
      totalDisbursed: disbursed._sum.amount ?? 0,
      expectedCommission: commissions.reduce(
        (sum, c) => sum + (c.expectedAmount ?? 0),
        0,
      ),
      receivedCommission: commissions.reduce(
        (sum, c) => sum + (c.actualAmount ?? 0),
        0,
      ),
    };
  }

  private async ensureRecord(
    loanApplicationId: string,
  ): Promise<CommissionRecord> {
    const existing = await this.db.commissionRecord.findUnique({
      where: { loanApplicationId },
    });
    return (
      existing ??
      (await this.db.commissionRecord.create({ data: { loanApplicationId } }))
    );
  }

  private async loadRecordWithProposal(
    loanApplicationId: string,
  ): Promise<CommissionRecord> {
    const record = await this.db.commissionRecord.findUnique({
      where: { loanApplicationId },
    });
    if (!record || !record.partnerCommissionModel) {
      throw new NotFoundException(
        'No partner commission has been proposed for this application',
      );
    }
    return record;
  }
}

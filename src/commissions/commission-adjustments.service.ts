import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionAdjustment, CommissionAdjustmentType } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

/**
 * Корекции по комисионите с дадена банка.
 *
 * Основният случай е clawback: банката приспада вече платена комисиона от
 * бъдещи плащания. Затова корекцията се записва като отрицателна сума на ниво
 * банка и тежи на баланса, докато не бъде уредена (приспадната).
 *
 * Системата НЕ иска автоматично пари обратно от партньора — това остава
 * решение на администратора.
 */
@Injectable()
export class CommissionAdjustmentsService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(
    bankId: string,
    dto: CreateAdjustmentDto,
    currentUser: AuthenticatedUser,
  ): Promise<CommissionAdjustment> {
    const bank = await this.db.bank.findUnique({ where: { id: bankId } });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }
    this.assertAmountSign(dto.type, dto.amount);

    if (dto.loanApplicationId) {
      const application = await this.db.loanApplication.findUnique({
        where: { id: dto.loanApplicationId },
      });
      if (!application) {
        throw new BadRequestException('Loan application not found');
      }
    }

    if (dto.bankPeriodBonusId) {
      const bonus = await this.db.bankPeriodBonus.findUnique({
        where: { id: dto.bankPeriodBonusId },
      });
      if (!bonus) {
        throw new BadRequestException('Bank period bonus not found');
      }
      if (bonus.bankId !== bankId) {
        throw new BadRequestException(
          'The bonus belongs to a different bank',
        );
      }
    }

    return this.db.commissionAdjustment.create({
      data: {
        bankId,
        loanApplicationId: dto.loanApplicationId,
        bankPeriodBonusId: dto.bankPeriodBonusId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        occurredAt: new Date(dto.occurredAt),
        createdByUserId: currentUser.userId,
      },
    });
  }

  findAllForBank(bankId: string, onlyOutstanding = false) {
    return this.db.commissionAdjustment.findMany({
      where: { bankId, ...(onlyOutstanding ? { settledAt: null } : {}) },
      orderBy: { occurredAt: 'desc' },
    });
  }

  findAllForApplication(loanApplicationId: string) {
    return this.db.commissionAdjustment.findMany({
      where: { loanApplicationId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /** Отбелязва корекцията като приспадната/уредена. */
  async settle(id: string, settledAt?: Date): Promise<CommissionAdjustment> {
    const adjustment = await this.db.commissionAdjustment.findUnique({
      where: { id },
    });
    if (!adjustment) {
      throw new NotFoundException('Adjustment not found');
    }
    if (adjustment.settledAt) {
      throw new BadRequestException('This adjustment is already settled');
    }
    return this.db.commissionAdjustment.update({
      where: { id },
      data: { settledAt: settledAt ?? new Date() },
    });
  }

  /** Неуредените корекции тежат на дължимото от банката. */
  async outstandingBalance(bankId: string): Promise<number> {
    const result = await this.db.commissionAdjustment.aggregate({
      _sum: { amount: true },
      where: { bankId, settledAt: null },
    });
    return result._sum.amount ?? 0;
  }

  private assertAmountSign(
    type: CommissionAdjustmentType,
    amount: number,
  ): void {
    if (amount === 0) {
      throw new BadRequestException('Adjustment amount cannot be zero');
    }
    if (type === CommissionAdjustmentType.CLAWBACK && amount > 0) {
      throw new BadRequestException(
        'A clawback takes money back — the amount must be negative',
      );
    }
    if (type === CommissionAdjustmentType.MANUAL_TOP_UP && amount < 0) {
      throw new BadRequestException(
        'A manual top-up adds money — the amount must be positive',
      );
    }
  }
}

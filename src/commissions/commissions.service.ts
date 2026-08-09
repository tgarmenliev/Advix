import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommissionLoanCategory,
  CommissionPeriodType,
  CommissionSchemeType,
  CommissionStatus,
  TrancheCommission,
} from '@prisma/client';
import { CommissionSchemesService } from '../commission-schemes/commission-schemes.service';
import {
  CalendarPeriod,
  calendarPeriod,
} from '../commission-schemes/period.util';
import { PrismaService } from '../database/prisma.service';
import { DisbursementsService } from '../disbursements/disbursements.service';
import {
  CommissionCalculationService,
  MonthlyBreakdownRow,
  PeriodCalculation,
} from './commission-calculation.service';

export interface RecalculationResult {
  period: CalendarPeriod;
  schemeId: string;
  volume: number;
  appliedPercent: number;
  total: number;
  /** Колко записа са създадени/обновени */
  affected: number;
  monthlyBreakdown: MonthlyBreakdownRow[];
}

/**
 * Свързва чистия калкулатор с базата: чете траншовете за периода, изчислява и
 * записва резултата.
 *
 * Преизчисляването е основната операция — обемът се променя със задна дата
 * (закъснял транш, корекция), а с него и достигнатата скала. Затова целият
 * период винаги се смята наново, вместо да се дописва.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly schemesService: CommissionSchemesService,
    private readonly disbursementsService: DisbursementsService,
    private readonly calculator: CommissionCalculationService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /**
   * Преизчислява и записва комисионите (или бонуса) за банка, категория и
   * периода, в който попада подадената дата.
   */
  async recalculate(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date = new Date(),
  ): Promise<RecalculationResult> {
    const { scheme, period, calculation } = await this.computePeriod(
      bankId,
      loanCategory,
      schemeType,
      at,
    );

    const affected =
      schemeType === CommissionSchemeType.BONUS
        ? await this.persistBonus(bankId, loanCategory, period, calculation)
        : await this.persistCommissions(calculation);

    return {
      period,
      schemeId: scheme.id,
      volume: calculation.volume,
      appliedPercent: calculation.appliedPercent,
      total: calculation.total,
      affected,
      monthlyBreakdown: calculation.monthlyBreakdown,
    };
  }

  /** Само изчисление, без запис — за преглед преди потвърждаване. */
  async preview(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date = new Date(),
  ) {
    const { scheme, period, calculation } = await this.computePeriod(
      bankId,
      loanCategory,
      schemeType,
      at,
    );
    return {
      period,
      schemeId: scheme.id,
      basis: scheme.basis,
      evaluationMode: scheme.evaluationMode,
      volume: calculation.volume,
      appliedPercent: calculation.appliedPercent,
      tier: calculation.tier,
      total: calculation.total,
      lines: calculation.lines,
      monthlyBreakdown: calculation.monthlyBreakdown,
    };
  }

  /** Отбелязва начислена/получена комисиона по транш. */
  async updateTrancheStatus(
    id: string,
    status: CommissionStatus,
    actualAmount?: number,
    occurredAt?: Date,
  ): Promise<TrancheCommission> {
    const commission = await this.db.trancheCommission.findUnique({
      where: { id },
    });
    if (!commission) {
      throw new NotFoundException('Tranche commission not found');
    }
    return this.db.trancheCommission.update({
      where: { id },
      data: {
        status,
        ...(actualAmount !== undefined && { actualAmount }),
        // Датата на получаване се пази; графикът на банката не се следи
        occurredAt:
          occurredAt ??
          (status === CommissionStatus.RECEIVED && !commission.occurredAt
            ? new Date()
            : commission.occurredAt),
      },
    });
  }

  async updateBonusStatus(
    id: string,
    status: CommissionStatus,
    actualAmount?: number,
    occurredAt?: Date,
  ) {
    const bonus = await this.db.bankPeriodBonus.findUnique({ where: { id } });
    if (!bonus) {
      throw new NotFoundException('Bank period bonus not found');
    }
    return this.db.bankPeriodBonus.update({
      where: { id },
      data: {
        status,
        ...(actualAmount !== undefined && { actualAmount }),
        occurredAt:
          occurredAt ??
          (status === CommissionStatus.RECEIVED && !bonus.occurredAt
            ? new Date()
            : bonus.occurredAt),
      },
    });
  }

  /** Комисионите по конкретна заявка (за досието и за нетния приход). */
  async findForApplication(loanApplicationId: string) {
    const record = await this.db.commissionRecord.findUnique({
      where: { loanApplicationId },
      include: {
        trancheCommissions: {
          include: { disbursement: true },
          orderBy: { disbursement: { trancheNumber: 'asc' } },
        },
      },
    });
    if (!record) {
      return {
        loanApplicationId,
        trancheCommissions: [],
        expectedTotal: 0,
        receivedTotal: 0,
      };
    }
    return {
      ...record,
      expectedTotal: record.trancheCommissions.reduce(
        (sum, tc) => sum + (tc.expectedAmount ?? 0),
        0,
      ),
      receivedTotal: record.trancheCommissions.reduce(
        (sum, tc) => sum + (tc.actualAmount ?? 0),
        0,
      ),
    };
  }

  // ---------------------------------------------------------------------------

  private async computePeriod(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date,
  ): Promise<{
    scheme: Awaited<ReturnType<CommissionSchemesService['resolveActive']>> & object;
    period: CalendarPeriod;
    calculation: PeriodCalculation;
  }> {
    const scheme = await this.schemesService.resolveActive(
      bankId,
      schemeType,
      loanCategory,
      at,
    );
    if (!scheme) {
      throw new BadRequestException(
        `No active ${schemeType} scheme for ${loanCategory} at ${at.toISOString().slice(0, 10)}`,
      );
    }

    // Фиксираният процент не зависи от обем — отчита се месечно за нуждите на
    // справките
    const period = calendarPeriod(
      at,
      scheme.periodType ?? CommissionPeriodType.MONTHLY,
    );

    const disbursements = await this.disbursementsService.findForPeriod(
      bankId,
      loanCategory,
      period,
    );

    const inputs = disbursements.map((d) => ({
      id: d.id,
      loanApplicationId: d.offer.loanApplicationId,
      amount: d.amount,
      disbursedAt: d.disbursedAt,
    }));

    const prior = await this.priorPerApplication(
      inputs.map((i) => i.loanApplicationId),
      period,
    );

    return {
      scheme,
      period,
      calculation: this.calculator.calculatePeriod(
        scheme,
        period,
        inputs,
        prior,
      ),
    };
  }

  /**
   * Вече начисленото по всяка сделка ПРЕДИ този период — за да не се надхвърли
   * таванът, когато траншовете ѝ са разпределени в различни периоди.
   */
  private async priorPerApplication(
    loanApplicationIds: string[],
    period: CalendarPeriod,
  ): Promise<Map<string, number>> {
    if (loanApplicationIds.length === 0) {
      return new Map();
    }
    const earlier = await this.db.trancheCommission.findMany({
      where: {
        disbursement: { disbursedAt: { lt: period.startsAt } },
        commissionRecord: {
          loanApplicationId: { in: loanApplicationIds },
        },
      },
      include: { commissionRecord: { select: { loanApplicationId: true } } },
    });

    const prior = new Map<string, number>();
    for (const tc of earlier) {
      const key = tc.commissionRecord.loanApplicationId;
      prior.set(key, (prior.get(key) ?? 0) + (tc.expectedAmount ?? 0));
    }
    return prior;
  }

  /** Записва комисионите по траншове, без да губи вече отбелязаните плащания. */
  private async persistCommissions(
    calculation: PeriodCalculation,
  ): Promise<number> {
    let affected = 0;

    for (const line of calculation.lines) {
      const record = await this.ensureCommissionRecord(line.loanApplicationId);

      await this.db.trancheCommission.upsert({
        where: { disbursementId: line.disbursementId },
        // Преизчисляване обновява само очакваната сума — статусът и реално
        // полученото остават каквито са били
        update: {
          expectedAmount: line.amount,
          commissionRecordId: record.id,
        },
        create: {
          disbursementId: line.disbursementId,
          commissionRecordId: record.id,
          expectedAmount: line.amount,
          status: CommissionStatus.EXPECTED,
        },
      });
      affected += 1;
    }

    return affected;
  }

  private async persistBonus(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    period: CalendarPeriod,
    calculation: PeriodCalculation,
  ): Promise<number> {
    const key = {
      bankId,
      loanCategory,
      periodType: period.type,
      periodYear: period.year,
      periodIndex: period.index,
    };

    await this.db.bankPeriodBonus.upsert({
      where: {
        bankId_loanCategory_periodType_periodYear_periodIndex: key,
      },
      update: {
        volume: calculation.volume,
        appliedPercent: calculation.appliedPercent,
        expectedAmount: calculation.total,
      },
      create: {
        ...key,
        periodLabel: period.label,
        volume: calculation.volume,
        appliedPercent: calculation.appliedPercent,
        expectedAmount: calculation.total,
        status: CommissionStatus.EXPECTED,
      },
    });

    return 1;
  }

  private async ensureCommissionRecord(loanApplicationId: string) {
    const existing = await this.db.commissionRecord.findUnique({
      where: { loanApplicationId },
    });
    if (existing) {
      return existing;
    }
    return this.db.commissionRecord.create({ data: { loanApplicationId } });
  }
}

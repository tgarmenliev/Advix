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
import {
  CommissionSchemesService,
  SchemeWithTiers,
} from '../commission-schemes/commission-schemes.service';
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
   *
   * @param schemeId Ръчен избор на схема — задължителен, когато банката има
   *        повече от една активна схема за тази категория+вид (напр. бизнес
   *        подкатегории). При една активна схема се резолва автоматично.
   */
  async recalculate(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date = new Date(),
    schemeId?: string,
  ): Promise<RecalculationResult> {
    const { scheme, period, calculation } = await this.computePeriod(
      bankId,
      loanCategory,
      schemeType,
      at,
      schemeId,
    );

    const affected =
      schemeType === CommissionSchemeType.BONUS
        ? await this.persistBonus(bankId, loanCategory, scheme.label, period, calculation)
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
    schemeId?: string,
  ) {
    const { scheme, period, calculation } = await this.computePeriod(
      bankId,
      loanCategory,
      schemeType,
      at,
      schemeId,
    );
    return {
      period,
      schemeId: scheme.id,
      label: scheme.label,
      basis: scheme.basis,
      evaluationMode: scheme.evaluationMode,
      volume: calculation.volume,
      dealCount: calculation.dealCount,
      appliedPercent: calculation.appliedPercent,
      tier: calculation.tier,
      total: calculation.total,
      lines: calculation.lines,
      monthlyBreakdown: calculation.monthlyBreakdown,
    };
  }

  /**
   * Активните схеми за банка+вид+категория — за да избере консултантът кога
   * има повече от една (бизнес подкатегории). Празен списък или единствен
   * елемент означава, че ръчен избор не е нужен.
   */
  async listActiveSchemes(
    bankId: string,
    schemeType: CommissionSchemeType,
    loanCategory: CommissionLoanCategory,
    at: Date = new Date(),
  ) {
    const schemes = await this.schemesService.findActiveSchemes(
      bankId,
      schemeType,
      loanCategory,
      at,
    );
    return schemes.map((s) => ({
      id: s.id,
      label: s.label,
      basis: s.basis,
    }));
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

  /**
   * Резолвира коя схема да се приложи и смята периода за нея.
   *
   * Ако е подаден `schemeId`, тя се използва директно (след проверка, че
   * действително принадлежи на банка+вид+категория и важи към датата). Иначе:
   * при точно една активна схема — резолва се автоматично (обичайният случай
   * — MORTGAGE/CONSUMER имат само по една); при повече от една — искаме
   * изричен избор, защото различните схеми са различни продукти на банката
   * (виж CommissionScheme.label) и не могат да се сумират безсмислено.
   */
  private async computePeriod(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date,
    schemeId?: string,
  ): Promise<{
    scheme: SchemeWithTiers;
    period: CalendarPeriod;
    calculation: PeriodCalculation;
  }> {
    const scheme = await this.resolveScheme(
      bankId,
      loanCategory,
      schemeType,
      at,
      schemeId,
    );

    // Фиксираният процент не зависи от обем — отчита се месечно за нуждите на
    // справките
    const period = calendarPeriod(
      at,
      scheme.periodType ?? CommissionPeriodType.MONTHLY,
    );

    // Когато схемата има label (бизнес подкатегория), траншовете се стесняват
    // до точно този продукт — иначе биха се смесили с друг паралелен продукт
    // на същата банка/категория
    const disbursements = await this.disbursementsService.findForPeriod(
      bankId,
      loanCategory,
      period,
      scheme.label ?? undefined,
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

  private async resolveScheme(
    bankId: string,
    loanCategory: CommissionLoanCategory,
    schemeType: CommissionSchemeType,
    at: Date,
    schemeId?: string,
  ): Promise<SchemeWithTiers> {
    if (schemeId) {
      const scheme = await this.schemesService.findOne(schemeId);
      if (
        scheme.bankId !== bankId ||
        scheme.schemeType !== schemeType ||
        scheme.loanCategory !== loanCategory
      ) {
        throw new BadRequestException(
          'The specified scheme does not match this bank, scheme type or loan category',
        );
      }
      if (scheme.validFrom > at || (scheme.validTo && scheme.validTo <= at)) {
        throw new BadRequestException(
          `The specified scheme is not active on ${at.toISOString().slice(0, 10)}`,
        );
      }
      return scheme;
    }

    const active = await this.schemesService.findActiveSchemes(
      bankId,
      schemeType,
      loanCategory,
      at,
    );
    if (active.length === 0) {
      throw new BadRequestException(
        `No active ${schemeType} scheme for ${loanCategory} at ${at.toISOString().slice(0, 10)}`,
      );
    }
    if (active.length > 1) {
      throw new BadRequestException({
        message:
          `This bank has ${active.length} active ${schemeType} schemes for ` +
          `${loanCategory} — specify schemeId`,
        schemes: active.map((s) => ({ id: s.id, label: s.label })),
      });
    }
    return active[0];
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
    schemeLabel: string | null,
    period: CalendarPeriod,
    calculation: PeriodCalculation,
  ): Promise<number> {
    // label е NOT NULL с default('') в базата — виж коментара в schema.prisma
    // защо null не може да участва в @@unique надеждно
    const label = schemeLabel ?? '';
    const key = {
      bankId,
      loanCategory,
      periodType: period.type,
      periodYear: period.year,
      periodIndex: period.index,
      label,
    };

    await this.db.bankPeriodBonus.upsert({
      where: {
        bankId_loanCategory_periodType_periodYear_periodIndex_label: key,
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

import { Injectable } from '@nestjs/common';
import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionPeriodType,
  CommissionTier,
} from '@prisma/client';
import { SchemeWithTiers } from '../commission-schemes/commission-schemes.service';
import {
  CalendarPeriod,
  calendarPeriod,
  monthlyCheckpoints,
} from '../commission-schemes/period.util';

/** Транш, подаден на калкулатора (без зависимост от Prisma моделите). */
export interface DisbursementInput {
  id: string;
  loanApplicationId: string;
  amount: number; // стотинки
  disbursedAt: Date;
}

/** Комисионата за един транш. */
export interface CommissionLine {
  disbursementId: string;
  loanApplicationId: string;
  disbursedAmount: number;
  percent: number;
  /** Пълната сума преди таван (стотинки) */
  grossAmount: number;
  /** Дължимата сума след таван на сделка (стотинки) */
  amount: number;
  capApplied: boolean;
}

/** Един ред от месечното отчитане при прогресивния режим. */
export interface MonthlyBreakdownRow {
  monthLabel: string;
  monthVolume: number;
  cumulativeVolume: number;
  /** Различни сделки (заявки) с усвояване през този месец */
  monthCount: number;
  /** Различни сделки от началото на периода до края на този месец — базата
   *  за COUNT_TIERED скалите */
  cumulativeCount: number;
  percent: number;
  /** Изкараното от обема на самия месец по текущия процент */
  earnedThisMonth: number;
  /** Доплащането за вече отчетените месеци, защото процентът се е вдигнал */
  retroactiveTopUp: number;
  /** Реално дължимото за месеца = изкарано + доплащане */
  payableThisMonth: number;
  cumulativePayable: number;
}

export interface PeriodCalculation {
  period: CalendarPeriod;
  volume: number;
  /** Различни сделки (заявки) с усвояване за периода — базата за COUNT_TIERED */
  dealCount: number;
  appliedPercent: number;
  tier: CommissionTier | null;
  lines: CommissionLine[];
  /** Сборът на дължимото по траншовете (след таван) */
  total: number;
  /** Само при PROGRESSIVE_RETROACTIVE — как изглежда отчетът месец по месец */
  monthlyBreakdown: MonthlyBreakdownRow[];
}

/**
 * Чист калкулационен слой за банкови комисиони и бонуси — само аритметика,
 * без достъп до базата и без странични ефекти.
 *
 * Скалите могат да зависят от ОБЕМ (VOLUME_TIERED — сума в стотинки) или от
 * БРОЙ сделки (COUNT_TIERED — напр. бизнес кредити: "0,6% при 2 бр./тримесечие,
 * 1% при 3+ бр."). Броят винаги е броят РАЗЛИЧНИ заявки с усвояване — две
 * траншове по една и съща заявка се броят за една сделка. Кой да е измерение
 * само определя КОЙ процент важи; сумата се смята винаги върху реално
 * усвоените пари (percent × amount), независимо как е избран процентът.
 *
 * Двата режима на отчитане дават ЕДИН И СЪЩ краен резултат; различава се само
 * кога влизат парите и как изглежда месечният отчет. Затова общата сума се
 * смята еднакво, а прогресивният режим добавя само разбивка по месеци.
 *
 * Всички суми са цели стотинки; закръгляването е до цяла стотинка.
 */
@Injectable()
export class CommissionCalculationService {
  /** Скалата по ОБЕМ, в която попада сумата (null извън VOLUME_TIERED). */
  resolveTier(scheme: SchemeWithTiers, volume: number): CommissionTier | null {
    if (scheme.basis !== CommissionBasis.VOLUME_TIERED) {
      return null;
    }
    return this.resolveTierFromList(
      scheme.tiers,
      volume,
      (t) => t.minVolume,
      (t) => t.maxVolume,
    );
  }

  /** Скалата по БРОЙ сделки, в която попада броят (null извън COUNT_TIERED). */
  resolveTierByCount(
    scheme: SchemeWithTiers,
    count: number,
  ): CommissionTier | null {
    if (scheme.basis !== CommissionBasis.COUNT_TIERED) {
      return null;
    }
    return this.resolveTierFromList(
      scheme.tiers,
      count,
      (t) => t.minCount,
      (t) => t.maxCount,
    );
  }

  /** Процентът, приложим към ЦЕЛИЯ обем за периода (VOLUME_TIERED/FLAT). */
  effectivePercent(scheme: SchemeWithTiers, volume: number): number {
    return this.percentForMeasures(scheme, { volume, count: 0 });
  }

  /**
   * Процентът спрямо мярката, отговаряща на basis на схемата: обем при
   * VOLUME_TIERED, брой сделки при COUNT_TIERED, винаги flatPercent при
   * FLAT_PERCENT. Това е единствената точка, от която calculatePeriod и
   * buildMonthlyBreakdown вземат процента — гарантира, че двете скали не се
   * объркват.
   */
  percentForMeasures(
    scheme: SchemeWithTiers,
    measures: { volume: number; count: number },
  ): number {
    switch (scheme.basis) {
      case CommissionBasis.FLAT_PERCENT:
        return scheme.flatPercent ?? 0;
      case CommissionBasis.COUNT_TIERED:
        return this.resolveTierByCount(scheme, measures.count)?.percent ?? 0;
      case CommissionBasis.VOLUME_TIERED:
      default:
        return this.resolveTier(scheme, measures.volume)?.percent ?? 0;
    }
  }

  /**
   * Пълно изчисление за един период.
   *
   * @param priorPerApplication вече начислена комисиона по заявка от предишни
   *        периоди — нужна, за да не се надхвърли таванът на сделка, когато
   *        траншовете ѝ са в различни периоди.
   */
  calculatePeriod(
    scheme: SchemeWithTiers,
    period: CalendarPeriod,
    disbursements: DisbursementInput[],
    priorPerApplication: Map<string, number> = new Map(),
  ): PeriodCalculation {
    const volume = disbursements.reduce((sum, d) => sum + d.amount, 0);
    const dealCount = new Set(disbursements.map((d) => d.loanApplicationId))
      .size;

    const tier =
      scheme.basis === CommissionBasis.COUNT_TIERED
        ? this.resolveTierByCount(scheme, dealCount)
        : this.resolveTier(scheme, volume);
    const appliedPercent = this.percentForMeasures(scheme, {
      volume,
      count: dealCount,
    });

    const lines = this.buildLines(
      scheme,
      disbursements,
      appliedPercent,
      priorPerApplication,
    );
    const total = lines.reduce((sum, line) => sum + line.amount, 0);

    const monthlyBreakdown =
      scheme.evaluationMode === CommissionEvaluationMode.PROGRESSIVE_RETROACTIVE
        ? this.buildMonthlyBreakdown(scheme, period, disbursements)
        : [];

    return {
      period,
      volume,
      dealCount,
      appliedPercent,
      tier,
      lines,
      total,
      monthlyBreakdown,
    };
  }

  /**
   * Месечно отчитане при прогресивния режим.
   *
   * Дължимото се смята върху НАТРУПАНИЯ обем по текущия процент, а от него се
   * вади вече изплатеното — така доплащането за минали месеци се получава
   * естествено и без натрупване на грешки от закръгляне. Процентът се
   * определя от натрупания обем ИЛИ натрупания брой сделки (спрямо basis), но
   * винаги се умножава по натрупания ПАРИЧЕН обем — броят само избира скалата.
   */
  buildMonthlyBreakdown(
    scheme: SchemeWithTiers,
    period: CalendarPeriod,
    disbursements: DisbursementInput[],
  ): MonthlyBreakdownRow[] {
    const rows: MonthlyBreakdownRow[] = [];
    let cumulativeVolume = 0;
    let cumulativePayable = 0;
    const seenApplications = new Set<string>();

    for (const monthStart of monthlyCheckpoints(period)) {
      const month = calendarPeriod(monthStart, CommissionPeriodType.MONTHLY);
      const monthDisbursements = disbursements.filter(
        (d) => d.disbursedAt >= month.startsAt && d.disbursedAt < month.endsAt,
      );
      const monthVolume = monthDisbursements.reduce(
        (sum, d) => sum + d.amount,
        0,
      );
      const monthApplications = new Set(
        monthDisbursements.map((d) => d.loanApplicationId),
      );
      for (const id of monthApplications) seenApplications.add(id);

      cumulativeVolume += monthVolume;
      const cumulativeCount = seenApplications.size;

      const percent = this.percentForMeasures(scheme, {
        volume: cumulativeVolume,
        count: cumulativeCount,
      });

      const payableSoFar = Math.round(cumulativeVolume * percent);
      const payableThisMonth = payableSoFar - cumulativePayable;
      const earnedThisMonth = Math.round(monthVolume * percent);

      rows.push({
        monthLabel: month.label,
        monthVolume,
        cumulativeVolume,
        monthCount: monthApplications.size,
        cumulativeCount,
        percent,
        earnedThisMonth,
        // Каквото остава над изкараното от този месец е доплащане назад
        retroactiveTopUp: payableThisMonth - earnedThisMonth,
        payableThisMonth,
        cumulativePayable: payableSoFar,
      });

      cumulativePayable = payableSoFar;
    }

    return rows;
  }

  /** Комисионата по всеки транш, с таван на ниво сделка. */
  private buildLines(
    scheme: SchemeWithTiers,
    disbursements: DisbursementInput[],
    percent: number,
    priorPerApplication: Map<string, number>,
  ): CommissionLine[] {
    const cap = scheme.maxPerDealAmount;
    // Таванът е за цялата сделка, затова траншовете се обхождат хронологично
    const ordered = [...disbursements].sort(
      (a, b) => a.disbursedAt.getTime() - b.disbursedAt.getTime(),
    );
    const runningPerApplication = new Map(priorPerApplication);

    return ordered.map((disbursement) => {
      const grossAmount = Math.round(disbursement.amount * percent);
      let amount = grossAmount;
      let capApplied = false;

      if (cap != null) {
        const alreadyEarned =
          runningPerApplication.get(disbursement.loanApplicationId) ?? 0;
        const remaining = Math.max(0, cap - alreadyEarned);
        if (grossAmount > remaining) {
          amount = remaining;
          capApplied = true;
        }
        runningPerApplication.set(
          disbursement.loanApplicationId,
          alreadyEarned + amount,
        );
      }

      return {
        disbursementId: disbursement.id,
        loanApplicationId: disbursement.loanApplicationId,
        disbursedAmount: disbursement.amount,
        percent,
        grossAmount,
        amount,
        capApplied,
      };
    });
  }

  /** Общ резолвър — намира скалата, в която попада мярката (обем или брой). */
  private resolveTierFromList(
    tiers: CommissionTier[],
    measure: number,
    getMin: (t: CommissionTier) => number | null,
    getMax: (t: CommissionTier) => number | null,
  ): CommissionTier | null {
    const sorted = [...tiers].sort(
      (a, b) => (getMin(a) ?? 0) - (getMin(b) ?? 0),
    );
    return (
      sorted.find((tier) => {
        const min = getMin(tier) ?? 0;
        const max = getMax(tier);
        return measure >= min && (max === null || measure < max);
      }) ??
      // Над последната граница попада в последната (отворена) скала
      sorted[sorted.length - 1] ??
      null
    );
  }
}

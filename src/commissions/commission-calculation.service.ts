import { Injectable } from '@nestjs/common';
import {
  CommissionBasis,
  CommissionEvaluationMode,
  CommissionTier,
} from '@prisma/client';
import { SchemeWithTiers } from '../commission-schemes/commission-schemes.service';
import {
  CalendarPeriod,
  calendarPeriod,
  monthlyCheckpoints,
} from '../commission-schemes/period.util';
import { CommissionPeriodType } from '@prisma/client';

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
 * Двата режима на отчитане дават ЕДИН И СЪЩ краен резултат; различава се само
 * кога влизат парите и как изглежда месечният отчет. Затова общата сума се
 * смята еднакво, а прогресивният режим добавя само разбивка по месеци.
 *
 * Всички суми са цели стотинки; закръгляването е до цяла стотинка.
 */
@Injectable()
export class CommissionCalculationService {
  /** Скалата, в която попада обемът (null при фиксиран процент). */
  resolveTier(scheme: SchemeWithTiers, volume: number): CommissionTier | null {
    if (scheme.basis !== CommissionBasis.VOLUME_TIERED) {
      return null;
    }
    const sorted = [...scheme.tiers].sort((a, b) => a.minVolume - b.minVolume);
    return (
      sorted.find(
        (tier) =>
          volume >= tier.minVolume &&
          (tier.maxVolume === null || volume < tier.maxVolume),
      ) ??
      // Обем над последната граница попада в последната (отворена) скала
      sorted[sorted.length - 1] ??
      null
    );
  }

  /** Процентът, приложим към ЦЕЛИЯ обем за периода. */
  effectivePercent(scheme: SchemeWithTiers, volume: number): number {
    if (scheme.basis === CommissionBasis.FLAT_PERCENT) {
      return scheme.flatPercent ?? 0;
    }
    return this.resolveTier(scheme, volume)?.percent ?? 0;
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
    const tier = this.resolveTier(scheme, volume);
    const appliedPercent = this.effectivePercent(scheme, volume);

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
   * естествено и без натрупване на грешки от закръгляне.
   */
  buildMonthlyBreakdown(
    scheme: SchemeWithTiers,
    period: CalendarPeriod,
    disbursements: DisbursementInput[],
  ): MonthlyBreakdownRow[] {
    const rows: MonthlyBreakdownRow[] = [];
    let cumulativeVolume = 0;
    let cumulativePayable = 0;

    for (const monthStart of monthlyCheckpoints(period)) {
      const month = calendarPeriod(monthStart, CommissionPeriodType.MONTHLY);
      const monthVolume = disbursements
        .filter(
          (d) => d.disbursedAt >= month.startsAt && d.disbursedAt < month.endsAt,
        )
        .reduce((sum, d) => sum + d.amount, 0);

      cumulativeVolume += monthVolume;
      const percent = this.effectivePercent(scheme, cumulativeVolume);

      const payableSoFar = Math.round(cumulativeVolume * percent);
      const payableThisMonth = payableSoFar - cumulativePayable;
      const earnedThisMonth = Math.round(monthVolume * percent);

      rows.push({
        monthLabel: month.label,
        monthVolume,
        cumulativeVolume,
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
}

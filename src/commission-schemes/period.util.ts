import { CommissionPeriodType } from '@prisma/client';

/**
 * Календарен период за отчитане на обем.
 *
 * Периодите са ПОДРАВНЕНИ КЪМ КАЛЕНДАРА — тримесечие означава януари–март,
 * април–юни и т.н. Не се задават произволни интервали (напр. август–октомври).
 *
 * `endsAt` е ИЗКЛЮЧВАЩ (началото на следващия период) — така интервалът се
 * ползва директно в заявки от вида `disbursedAt >= startsAt AND < endsAt`,
 * без гранични грешки от последната милисекунда.
 */
export interface CalendarPeriod {
  type: CommissionPeriodType;
  year: number;
  /** 1-базиран номер в рамките на годината (месец 1–12, тримесечие 1–4…) */
  index: number;
  startsAt: Date;
  endsAt: Date;
  /** Четим етикет: "2026-08", "2026-Q1", "2026-H2", "2026" */
  label: string;
}

/** Колко месеца обхваща един период от даден тип. */
export function monthsPerPeriod(type: CommissionPeriodType): number {
  switch (type) {
    case CommissionPeriodType.MONTHLY:
      return 1;
    case CommissionPeriodType.QUARTERLY:
      return 3;
    case CommissionPeriodType.SEMI_ANNUAL:
      return 6;
    case CommissionPeriodType.ANNUAL:
      return 12;
  }
}

/** Календарният период, в който попада дадена дата. */
export function calendarPeriod(
  date: Date,
  type: CommissionPeriodType,
): CalendarPeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-базиран
  const span = monthsPerPeriod(type);

  const startMonth = Math.floor(month / span) * span;
  const index = startMonth / span + 1;

  const startsAt = new Date(Date.UTC(year, startMonth, 1));
  const endsAt = new Date(Date.UTC(year, startMonth + span, 1));

  return { type, year, index, startsAt, endsAt, label: periodLabel(type, year, index) };
}

/** Периодът по явни година и номер (за отчети по зададен период). */
export function periodByIndex(
  type: CommissionPeriodType,
  year: number,
  index: number,
): CalendarPeriod {
  const span = monthsPerPeriod(type);
  const maxIndex = 12 / span;
  if (!Number.isInteger(index) || index < 1 || index > maxIndex) {
    throw new RangeError(
      `Period index ${index} is out of range for ${type} (1..${maxIndex})`,
    );
  }
  const startMonth = (index - 1) * span;
  return {
    type,
    year,
    index,
    startsAt: new Date(Date.UTC(year, startMonth, 1)),
    endsAt: new Date(Date.UTC(year, startMonth + span, 1)),
    label: periodLabel(type, year, index),
  };
}

/**
 * Месечните контролни точки в рамките на период — при прогресивния режим
 * обемът се отчита в края на всеки от тези месеци.
 * Връща началата на месеците, включени в периода.
 */
export function monthlyCheckpoints(period: CalendarPeriod): Date[] {
  const months = monthsPerPeriod(period.type);
  const startMonth = period.startsAt.getUTCMonth();
  return Array.from({ length: months }, (_, offset) =>
    new Date(Date.UTC(period.year, startMonth + offset, 1)),
  );
}

function periodLabel(
  type: CommissionPeriodType,
  year: number,
  index: number,
): string {
  switch (type) {
    case CommissionPeriodType.MONTHLY:
      return `${year}-${String(index).padStart(2, '0')}`;
    case CommissionPeriodType.QUARTERLY:
      return `${year}-Q${index}`;
    case CommissionPeriodType.SEMI_ANNUAL:
      return `${year}-H${index}`;
    case CommissionPeriodType.ANNUAL:
      return `${year}`;
  }
}

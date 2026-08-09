import { CommissionPeriodType } from '@prisma/client';
import {
  calendarPeriod,
  monthlyCheckpoints,
  periodByIndex,
} from './period.util';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('calendarPeriod — календарно подравняване', () => {
  it('тримесечие: 9 август попада в Q3 (юли–септември), НЕ в „август–октомври"', () => {
    const period = calendarPeriod(
      new Date(Date.UTC(2026, 7, 9)), // 2026-08-09
      CommissionPeriodType.QUARTERLY,
    );

    expect(period.index).toBe(3);
    expect(iso(period.startsAt)).toBe('2026-07-01');
    expect(iso(period.endsAt)).toBe('2026-10-01'); // изключващ
    expect(period.label).toBe('2026-Q3');
  });

  it.each([
    [0, 1, '2026-01-01', '2026-04-01'], // януари → Q1
    [2, 1, '2026-01-01', '2026-04-01'], // март → Q1
    [3, 2, '2026-04-01', '2026-07-01'], // април → Q2
    [11, 4, '2026-10-01', '2027-01-01'], // декември → Q4, минава в следв. година
  ])(
    'месец %i е в тримесечие %i (%s → %s)',
    (month, expectedIndex, start, end) => {
      const period = calendarPeriod(
        new Date(Date.UTC(2026, month, 15)),
        CommissionPeriodType.QUARTERLY,
      );
      expect(period.index).toBe(expectedIndex);
      expect(iso(period.startsAt)).toBe(start);
      expect(iso(period.endsAt)).toBe(end);
    },
  );

  it('месечен период', () => {
    const period = calendarPeriod(
      new Date(Date.UTC(2026, 1, 28)),
      CommissionPeriodType.MONTHLY,
    );
    expect(period.index).toBe(2);
    expect(iso(period.startsAt)).toBe('2026-02-01');
    expect(iso(period.endsAt)).toBe('2026-03-01');
    expect(period.label).toBe('2026-02');
  });

  it('полугодие', () => {
    const first = calendarPeriod(
      new Date(Date.UTC(2026, 5, 30)), // юни
      CommissionPeriodType.SEMI_ANNUAL,
    );
    expect(first.index).toBe(1);
    expect(first.label).toBe('2026-H1');

    const second = calendarPeriod(
      new Date(Date.UTC(2026, 6, 1)), // юли
      CommissionPeriodType.SEMI_ANNUAL,
    );
    expect(second.index).toBe(2);
    expect(iso(second.startsAt)).toBe('2026-07-01');
  });

  it('годишен период', () => {
    const period = calendarPeriod(
      new Date(Date.UTC(2026, 10, 3)),
      CommissionPeriodType.ANNUAL,
    );
    expect(iso(period.startsAt)).toBe('2026-01-01');
    expect(iso(period.endsAt)).toBe('2027-01-01');
    expect(period.label).toBe('2026');
  });

  it('първата милисекунда на периода принадлежи на него', () => {
    const period = calendarPeriod(
      new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0)),
      CommissionPeriodType.QUARTERLY,
    );
    expect(period.index).toBe(2);
  });

  it('последната милисекунда преди endsAt е още в периода', () => {
    const period = calendarPeriod(
      new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999)),
      CommissionPeriodType.QUARTERLY,
    );
    expect(period.index).toBe(2);
    expect(iso(period.endsAt)).toBe('2026-07-01');
  });
});

describe('periodByIndex', () => {
  it('връща периода по година и номер', () => {
    const period = periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 2);
    expect(iso(period.startsAt)).toBe('2026-04-01');
    expect(period.label).toBe('2026-Q2');
  });

  it('отхвърля номер извън обхвата', () => {
    expect(() =>
      periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 5),
    ).toThrow(RangeError);
    expect(() => periodByIndex(CommissionPeriodType.MONTHLY, 2026, 13)).toThrow(
      RangeError,
    );
    expect(() => periodByIndex(CommissionPeriodType.ANNUAL, 2026, 2)).toThrow(
      RangeError,
    );
  });
});

describe('monthlyCheckpoints — контролни точки при прогресивния режим', () => {
  it('тримесечие дава 3 месечни точки', () => {
    const period = periodByIndex(CommissionPeriodType.QUARTERLY, 2026, 1);
    expect(monthlyCheckpoints(period).map(iso)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('месечен период дава една точка', () => {
    const period = periodByIndex(CommissionPeriodType.MONTHLY, 2026, 5);
    expect(monthlyCheckpoints(period).map(iso)).toEqual(['2026-05-01']);
  });

  it('годишен период дава 12 точки', () => {
    const period = periodByIndex(CommissionPeriodType.ANNUAL, 2026, 1);
    expect(monthlyCheckpoints(period)).toHaveLength(12);
  });
});

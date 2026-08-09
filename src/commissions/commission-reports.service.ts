import { Injectable } from '@nestjs/common';
import {
  CommissionStatus,
  PartnerCommissionStatus,
  Prisma,
} from '@prisma/client';
import { CalendarPeriod } from '../commission-schemes/period.util';
import { PrismaService } from '../database/prisma.service';
import { CommissionAdjustmentsService } from './commission-adjustments.service';

export interface CommissionTotals {
  expected: number;
  accrued: number;
  received: number;
}

export interface BankSummary {
  bankId: string;
  bankName: string;
  commissions: CommissionTotals;
  bonuses: CommissionTotals;
  /** Неуредени корекции (отрицателни при clawback) */
  outstandingAdjustments: number;
  /** Получено общо, коригирано с неуредените корекции */
  netReceived: number;
  /** Още неполучено: очаквано минус получено */
  outstanding: number;
}

export interface PortfolioSummary {
  banks: BankSummary[];
  totals: {
    expected: number;
    received: number;
    outstandingAdjustments: number;
    netReceived: number;
    partnerApproved: number;
    partnerPaid: number;
    /** Получено минус изплатено на партньори */
    netRevenue: number;
  };
  period?: { label: string; startsAt: Date; endsAt: Date };
}

/**
 * Справки за комисионите — това е крайната цел на модула: посредникът да вижда
 * какво реално е получил, какво още му дължат и по коя банка.
 */
@Injectable()
export class CommissionReportsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly adjustmentsService: CommissionAdjustmentsService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /** Обобщение по всички банки, по избор ограничено до период. */
  async portfolio(period?: CalendarPeriod): Promise<PortfolioSummary> {
    const banks = await this.db.bank.findMany({ orderBy: { name: 'asc' } });

    const summaries = await Promise.all(
      banks.map((bank) => this.bankSummary(bank.id, bank.name, period)),
    );

    // Банки без никакво движение само шумят в справката
    const withActivity = summaries.filter(
      (s) =>
        s.commissions.expected !== 0 ||
        s.bonuses.expected !== 0 ||
        s.outstandingAdjustments !== 0,
    );

    const partner = await this.partnerTotals(period);

    const totals = withActivity.reduce(
      (acc, s) => ({
        expected: acc.expected + s.commissions.expected + s.bonuses.expected,
        received: acc.received + s.commissions.received + s.bonuses.received,
        outstandingAdjustments:
          acc.outstandingAdjustments + s.outstandingAdjustments,
        netReceived: acc.netReceived + s.netReceived,
        partnerApproved: partner.approved,
        partnerPaid: partner.paid,
        netRevenue: 0,
      }),
      {
        expected: 0,
        received: 0,
        outstandingAdjustments: 0,
        netReceived: 0,
        partnerApproved: partner.approved,
        partnerPaid: partner.paid,
        netRevenue: 0,
      },
    );
    totals.netRevenue = totals.netReceived - partner.paid;

    return {
      banks: withActivity,
      totals,
      ...(period
        ? {
            period: {
              label: period.label,
              startsAt: period.startsAt,
              endsAt: period.endsAt,
            },
          }
        : {}),
    };
  }

  async bankSummary(
    bankId: string,
    bankName?: string,
    period?: CalendarPeriod,
  ): Promise<BankSummary> {
    const name =
      bankName ??
      (await this.db.bank.findUnique({ where: { id: bankId } }))?.name ??
      '';

    const [commissions, bonuses, outstandingAdjustments] = await Promise.all([
      this.commissionTotals(bankId, period),
      this.bonusTotals(bankId, period),
      this.adjustmentsService.outstandingBalance(bankId),
    ]);

    const received = commissions.received + bonuses.received;
    const expected = commissions.expected + bonuses.expected;

    return {
      bankId,
      bankName: name,
      commissions,
      bonuses,
      outstandingAdjustments,
      netReceived: received + outstandingAdjustments,
      outstanding: expected - received,
    };
  }

  /** Комисиони по траншове, сумирани по статус. */
  private async commissionTotals(
    bankId: string,
    period?: CalendarPeriod,
  ): Promise<CommissionTotals> {
    const where: Prisma.TrancheCommissionWhereInput = {
      disbursement: {
        offer: { bankId },
        ...(period
          ? { disbursedAt: { gte: period.startsAt, lt: period.endsAt } }
          : {}),
      },
    };

    const rows = await this.db.trancheCommission.findMany({
      where,
      select: { expectedAmount: true, actualAmount: true, status: true },
    });

    return rows.reduce<CommissionTotals>(
      (acc, row) => ({
        expected: acc.expected + (row.expectedAmount ?? 0),
        accrued:
          acc.accrued +
          (row.status === CommissionStatus.ACCRUED ||
          row.status === CommissionStatus.RECEIVED
            ? (row.actualAmount ?? row.expectedAmount ?? 0)
            : 0),
        received:
          acc.received +
          (row.status === CommissionStatus.RECEIVED
            ? (row.actualAmount ?? row.expectedAmount ?? 0)
            : 0),
      }),
      { expected: 0, accrued: 0, received: 0 },
    );
  }

  private async bonusTotals(
    bankId: string,
    period?: CalendarPeriod,
  ): Promise<CommissionTotals> {
    const rows = await this.db.bankPeriodBonus.findMany({
      where: {
        bankId,
        ...(period
          ? { periodYear: period.year, periodIndex: period.index }
          : {}),
      },
      select: { expectedAmount: true, actualAmount: true, status: true },
    });

    return rows.reduce<CommissionTotals>(
      (acc, row) => ({
        expected: acc.expected + row.expectedAmount,
        accrued:
          acc.accrued +
          (row.status === CommissionStatus.ACCRUED ||
          row.status === CommissionStatus.RECEIVED
            ? (row.actualAmount ?? row.expectedAmount)
            : 0),
        received:
          acc.received +
          (row.status === CommissionStatus.RECEIVED
            ? (row.actualAmount ?? row.expectedAmount)
            : 0),
      }),
      { expected: 0, accrued: 0, received: 0 },
    );
  }

  /** Дължимо и изплатено към партньори. */
  private async partnerTotals(period?: CalendarPeriod) {
    const rows = await this.db.commissionRecord.findMany({
      where: {
        partnerCommissionStatus: {
          in: [PartnerCommissionStatus.APPROVED, PartnerCommissionStatus.PAID],
        },
        ...(period
          ? {
              partnerCommissionApprovedAt: {
                gte: period.startsAt,
                lt: period.endsAt,
              },
            }
          : {}),
      },
      select: { partnerCommissionAmount: true, partnerCommissionStatus: true },
    });

    return rows.reduce(
      (acc, row) => {
        const amount = row.partnerCommissionAmount ?? 0;
        return {
          approved: acc.approved + amount,
          paid:
            acc.paid +
            (row.partnerCommissionStatus === PartnerCommissionStatus.PAID
              ? amount
              : 0),
        };
      },
      { approved: 0, paid: 0 },
    );
  }

  /** Дължимо по партньори — кой колко чака да получи. */
  async byPartner() {
    const rows = await this.db.commissionRecord.findMany({
      where: {
        partnerId: { not: null },
        partnerCommissionStatus: {
          in: [PartnerCommissionStatus.APPROVED, PartnerCommissionStatus.PAID],
        },
      },
      select: {
        partnerId: true,
        loanApplicationId: true,
        partnerCommissionAmount: true,
        partnerCommissionStatus: true,
      },
    });

    const byPartner = new Map<
      string,
      { partnerId: string; deals: number; approved: number; paid: number }
    >();

    for (const row of rows) {
      const key = row.partnerId!;
      const entry = byPartner.get(key) ?? {
        partnerId: key,
        deals: 0,
        approved: 0,
        paid: 0,
      };
      const amount = row.partnerCommissionAmount ?? 0;
      entry.deals += 1;
      if (row.partnerCommissionStatus === PartnerCommissionStatus.PAID) {
        entry.paid += amount;
      } else {
        entry.approved += amount;
      }
      byPartner.set(key, entry);
    }

    return [...byPartner.values()].sort((a, b) => b.approved - a.approved);
  }
}

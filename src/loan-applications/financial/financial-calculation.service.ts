import { Injectable, NotFoundException } from '@nestjs/common';
import { LoanType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface IncomeBreakdown {
  clientIncome: number; // стотинки
  coBorrowersIncome: number; // стотинки
  totalIncome: number; // стотинки
}

export interface ObligationsBreakdown {
  clientObligations: number; // стотинки
  coBorrowersObligations: number; // стотинки
  totalObligations: number; // стотинки
}

export interface DownPaymentResult {
  downPayment: number; // стотинки
  downPaymentPercent: number; // процент, 2 десетични знака
}

export interface FinancialSummary {
  totalIncome: number; // стотинки
  totalObligations: number; // стотинки
  debtToIncomeRatio: number | null; // процент, 2 десетични знака
  downPayment: number | null; // стотинки
  downPaymentPercent: number | null; // процент
  disposableIncome: number; // стотинки
}

/**
 * ЧИСТ калкулационен слой — само изчисления, без странични ефекти.
 *
 * ВАЖНО (MASTER_CONTEXT забрана №1): този слой САМО изчислява и показва.
 * Той НЕ взема решения дали кредит е одобрим, НЕ препоръчва суми и НЕ блокира
 * workflow преходи на база на съотношенията. Числата са за консултанта —
 * той преценява.
 *
 * Всички суми са Int в стотинки; сумирането е целочислено, само процентните
 * съотношения са дробни (закръглени до 2 знака).
 */
@Injectable()
export class FinancialCalculationService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /**
   * Общ месечен доход = netSalary на клиента + netSalary на лицата,
   * ВКЛЮЧЕНИ в тази заявка (през junction таблицата — не всички роднини!).
   */
  async calculateTotalIncome(applicationId: string): Promise<IncomeBreakdown> {
    const { client, includedMembers } = await this.loadContext(applicationId);

    const clientIncome = client.netSalary ?? 0;
    const coBorrowersIncome = includedMembers.reduce(
      (sum, member) => sum + (member.netSalary ?? 0),
      0,
    );

    return {
      clientIncome,
      coBorrowersIncome,
      totalIncome: clientIncome + coBorrowersIncome,
    };
  }

  /**
   * Общи месечни задължения = existingLoansMonthlyTotal на клиента + на
   * включените лица. (Семантика на полето: само задължения, които НЯМА да се
   * рефинансират.)
   */
  async calculateTotalObligations(
    applicationId: string,
  ): Promise<ObligationsBreakdown> {
    const { client, includedMembers } = await this.loadContext(applicationId);

    const clientObligations = client.existingLoansMonthlyTotal ?? 0;
    const coBorrowersObligations = includedMembers.reduce(
      (sum, member) => sum + (member.existingLoansMonthlyTotal ?? 0),
      0,
    );

    return {
      clientObligations,
      coBorrowersObligations,
      totalObligations: clientObligations + coBorrowersObligations,
    };
  }

  /**
   * Дълг/Доход като процент с 2 десетични знака.
   * При нулев доход → null (данните може още да не са попълнени — не е грешка).
   */
  async calculateDebtToIncome(applicationId: string): Promise<number | null> {
    const [{ totalIncome }, { totalObligations }] = await Promise.all([
      this.calculateTotalIncome(applicationId),
      this.calculateTotalObligations(applicationId),
    ]);
    return this.ratioAsPercent(totalObligations, totalIncome);
  }

  /**
   * Самоучастие — само при MORTGAGE_WITH_PURCHASE:
   *   самоучастие = пазарна цена на имота − размер на кредита
   * Пазарната цена идва от LoanApplicationProperty.marketValue (първият свързан
   * имот с попълнена цена — на практика заявката има един имот).
   * Без имот с marketValue или друг тип кредит → null.
   */
  async calculateDownPayment(
    applicationId: string,
  ): Promise<DownPaymentResult | null> {
    const { application, propertyLinks } =
      await this.loadContext(applicationId);

    if (application.loanType !== LoanType.MORTGAGE_WITH_PURCHASE) {
      return null;
    }

    const linkWithValue = propertyLinks.find(
      (link) => link.marketValue != null,
    );
    if (!linkWithValue?.marketValue) {
      return null;
    }

    const downPayment = linkWithValue.marketValue - application.amount;
    return {
      downPayment,
      downPaymentPercent: this.ratioAsPercent(
        downPayment,
        linkWithValue.marketValue,
      )!,
    };
  }

  /** Агрегира всичко в един обект за консултанта. */
  async getFinancialSummary(applicationId: string): Promise<FinancialSummary> {
    const [income, obligations, downPayment] = await Promise.all([
      this.calculateTotalIncome(applicationId),
      this.calculateTotalObligations(applicationId),
      this.calculateDownPayment(applicationId),
    ]);

    return {
      totalIncome: income.totalIncome,
      totalObligations: obligations.totalObligations,
      debtToIncomeRatio: this.ratioAsPercent(
        obligations.totalObligations,
        income.totalIncome,
      ),
      downPayment: downPayment?.downPayment ?? null,
      downPaymentPercent: downPayment?.downPaymentPercent ?? null,
      disposableIncome: income.totalIncome - obligations.totalObligations,
    };
  }

  /** Зарежда клиент + ВКЛЮЧЕНИТЕ лица + имотните връзки на заявката. */
  private async loadContext(applicationId: string) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: applicationId },
      include: {
        client: true,
        familyMembers: {
          where: { familyMember: { deletedAt: null } },
          include: { familyMember: true },
        },
        properties: true,
      },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }
    return {
      application,
      client: application.client,
      includedMembers: application.familyMembers.map(
        (link) => link.familyMember,
      ),
      propertyLinks: application.properties,
    };
  }

  /** numerator/denominator като процент с 2 знака; при денominator 0 → null. */
  private ratioAsPercent(
    numerator: number,
    denominator: number,
  ): number | null {
    if (denominator === 0) {
      return null;
    }
    return Math.round((numerator / denominator) * 100 * 100) / 100;
  }
}

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoanType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FinancialCalculationService } from './financial-calculation.service';

describe('FinancialCalculationService', () => {
  let service: FinancialCalculationService;

  const loanApplicationDelegate = { findUnique: jest.fn() };

  const prismaMock = {
    get tenantDb() {
      return { loanApplication: loanApplicationDelegate };
    },
  };

  /**
   * Хелпър: заявка с клиент, ВКЛЮЧЕНИ лица (junction) и имотни връзки.
   * ВАЖНО: familyMembers тук са само включените в заявката — service-ът чете
   * junction таблицата, не всички роднини на клиента.
   */
  const mockApplication = (overrides: {
    loanType?: LoanType;
    amount?: number;
    client?: Record<string, unknown>;
    includedMembers?: Array<Record<string, unknown>>;
    propertyLinks?: Array<Record<string, unknown>>;
  }) => {
    loanApplicationDelegate.findUnique.mockResolvedValue({
      id: 'app-1',
      loanType: overrides.loanType ?? LoanType.MORTGAGE_WITH_PURCHASE,
      amount: overrides.amount ?? 20000000,
      client: {
        id: 'client-1',
        netSalary: null,
        existingLoansMonthlyTotal: null,
        ...overrides.client,
      },
      familyMembers: (overrides.includedMembers ?? []).map((member) => ({
        familyMember: member,
      })),
      properties: overrides.propertyLinks ?? [],
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        FinancialCalculationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(FinancialCalculationService);
  });

  describe('calculateTotalIncome — СПЕЦИФИЧНИЯТ тест за коректност', () => {
    it('брои клиента + САМО включените в заявката лица (350000, не 450000)', async () => {
      // Сценарият от заданието:
      // клиент 200000; FamilyMember А (ВКЛЮЧЕН) 150000;
      // FamilyMember Б (НЕ включен) 100000 — Б изобщо не идва от junction-а
      mockApplication({
        client: { netSalary: 200000 },
        includedMembers: [
          { id: 'fm-A', netSalary: 150000 }, // само А е в junction таблицата
        ],
      });

      const result = await service.calculateTotalIncome('app-1');

      expect(result).toEqual({
        clientIncome: 200000,
        coBorrowersIncome: 150000,
        totalIncome: 350000, // НЕ 450000 — Б не е включен в заявката
      });
    });

    it('непопълнен netSalary се брои като 0, не гърми', async () => {
      mockApplication({
        client: { netSalary: null },
        includedMembers: [{ id: 'fm-A', netSalary: null }],
      });

      const result = await service.calculateTotalIncome('app-1');

      expect(result.totalIncome).toBe(0);
    });
  });

  describe('calculateTotalObligations', () => {
    it('сумира задълженията на клиента и включените лица', async () => {
      mockApplication({
        client: { existingLoansMonthlyTotal: 45000 },
        includedMembers: [
          { id: 'fm-A', existingLoansMonthlyTotal: 30000 },
          { id: 'fm-B', existingLoansMonthlyTotal: null },
        ],
      });

      const result = await service.calculateTotalObligations('app-1');

      expect(result).toEqual({
        clientObligations: 45000,
        coBorrowersObligations: 30000,
        totalObligations: 75000,
      });
    });
  });

  describe('calculateDebtToIncome', () => {
    it('връща процент с 2 десетични знака', async () => {
      mockApplication({
        client: { netSalary: 350000, existingLoansMonthlyTotal: 75000 },
      });

      const result = await service.calculateDebtToIncome('app-1');

      // 75000 / 350000 = 21.4285…% → 21.43
      expect(result).toBe(21.43);
    });

    it('при нулев доход → null, НЕ грешка (данните може да не са попълнени)', async () => {
      mockApplication({
        client: { netSalary: null, existingLoansMonthlyTotal: 50000 },
      });

      await expect(service.calculateDebtToIncome('app-1')).resolves.toBeNull();
    });
  });

  describe('calculateDownPayment — самоучастие', () => {
    it('MORTGAGE_WITH_PURCHASE с имот → marketValue − amount', async () => {
      mockApplication({
        loanType: LoanType.MORTGAGE_WITH_PURCHASE,
        amount: 20000000, // 200 000.00
        propertyLinks: [{ id: 'link-1', marketValue: 25000000 }], // 250 000.00
      });

      const result = await service.calculateDownPayment('app-1');

      expect(result).toEqual({
        downPayment: 5000000, // 50 000.00 в стотинки
        downPaymentPercent: 20, // 5000000 / 25000000 = 20.00%
      });
    });

    it('без свързан имот с marketValue → null', async () => {
      mockApplication({
        loanType: LoanType.MORTGAGE_WITH_PURCHASE,
        propertyLinks: [{ id: 'link-1', marketValue: null }],
      });

      await expect(service.calculateDownPayment('app-1')).resolves.toBeNull();
    });

    it('не се прилага при друг тип кредит (MORTGAGE_NO_PURCHASE)', async () => {
      mockApplication({
        loanType: LoanType.MORTGAGE_NO_PURCHASE,
        propertyLinks: [{ id: 'link-1', marketValue: 25000000 }],
      });

      await expect(service.calculateDownPayment('app-1')).resolves.toBeNull();
    });
  });

  describe('getFinancialSummary', () => {
    it('агрегира всичко; disposableIncome = доход − задължения (стотинки)', async () => {
      mockApplication({
        loanType: LoanType.MORTGAGE_WITH_PURCHASE,
        amount: 20000000,
        client: { netSalary: 200000, existingLoansMonthlyTotal: 45000 },
        includedMembers: [
          {
            id: 'fm-A',
            netSalary: 150000,
            existingLoansMonthlyTotal: 30000,
          },
        ],
        propertyLinks: [{ id: 'link-1', marketValue: 25000000 }],
      });

      const summary = await service.getFinancialSummary('app-1');

      expect(summary).toEqual({
        totalIncome: 350000,
        totalObligations: 75000,
        debtToIncomeRatio: 21.43,
        downPayment: 5000000,
        downPaymentPercent: 20,
        disposableIncome: 275000, // 350000 − 75000, целочислено
      });
    });

    it('хвърля NotFoundException при несъществуваща заявка', async () => {
      loanApplicationDelegate.findUnique.mockResolvedValue(null);

      await expect(
        service.getFinancialSummary('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

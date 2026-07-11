import { BadRequestException } from '@nestjs/common';
import { LoanStatus } from '@prisma/client';
import { WorkflowService } from './workflow.service';

describe('WorkflowService', () => {
  const service = new WorkflowService();

  // Точното копие на преходите от MASTER_CONTEXT
  const VALID_TRANSITIONS: Array<[LoanStatus, LoanStatus]> = [
    [LoanStatus.NEW, LoanStatus.COLLECTING_INFO],
    [LoanStatus.COLLECTING_INFO, LoanStatus.WAITING_CLIENT],
    [LoanStatus.COLLECTING_INFO, LoanStatus.INTERNAL_PROCESSING],
    [LoanStatus.WAITING_CLIENT, LoanStatus.COLLECTING_INFO],
    [LoanStatus.WAITING_CLIENT, LoanStatus.INTERNAL_PROCESSING],
    [LoanStatus.INTERNAL_PROCESSING, LoanStatus.COLLECTING_INFO],
    [LoanStatus.INTERNAL_PROCESSING, LoanStatus.READY_FOR_BANK],
    [LoanStatus.READY_FOR_BANK, LoanStatus.SENT_TO_BANKS],
    [LoanStatus.SENT_TO_BANKS, LoanStatus.OFFERS_RECEIVED],
    [LoanStatus.OFFERS_RECEIVED, LoanStatus.OFFER_SELECTED],
    [LoanStatus.OFFER_SELECTED, LoanStatus.APPLICATION_SUBMITTED],
    [LoanStatus.APPLICATION_SUBMITTED, LoanStatus.APPROVED],
    [LoanStatus.APPLICATION_SUBMITTED, LoanStatus.REJECTED_BY_BANK],
    [LoanStatus.APPROVED, LoanStatus.DISBURSED],
    [LoanStatus.REJECTED_BY_BANK, LoanStatus.SENT_TO_BANKS],
    [LoanStatus.REJECTED_BY_BANK, LoanStatus.REJECTED_BY_CLIENT],
    [LoanStatus.DISBURSED, LoanStatus.COMPLETED],
  ];

  it.each(VALID_TRANSITIONS)('позволява %s → %s', (from, to) => {
    expect(service.canTransition(from, to)).toBe(true);
    expect(() => service.assertTransition(from, to)).not.toThrow();
  });

  it('позволява ANY_STATUS → REJECTED_BY_CLIENT', () => {
    for (const from of Object.values(LoanStatus)) {
      if (from !== LoanStatus.REJECTED_BY_CLIENT) {
        expect(service.canTransition(from, LoanStatus.REJECTED_BY_CLIENT)).toBe(
          true,
        );
      }
    }
  });

  const INVALID_TRANSITIONS: Array<[LoanStatus, LoanStatus]> = [
    [LoanStatus.NEW, LoanStatus.READY_FOR_BANK], // прескача стъпки
    [LoanStatus.NEW, LoanStatus.SENT_TO_BANKS],
    [LoanStatus.COLLECTING_INFO, LoanStatus.READY_FOR_BANK],
    [LoanStatus.READY_FOR_BANK, LoanStatus.NEW], // назад извън позволеното
    [LoanStatus.SENT_TO_BANKS, LoanStatus.APPROVED],
    [LoanStatus.COMPLETED, LoanStatus.NEW], // от терминален статус
    [LoanStatus.REJECTED_BY_CLIENT, LoanStatus.COLLECTING_INFO],
    [LoanStatus.APPROVED, LoanStatus.SENT_TO_BANKS],
  ];

  it.each(INVALID_TRANSITIONS)('отхвърля %s → %s', (from, to) => {
    expect(service.canTransition(from, to)).toBe(false);
    expect(() => service.assertTransition(from, to)).toThrow(
      BadRequestException,
    );
  });

  it('отхвърля преход към същия статус', () => {
    expect(service.canTransition(LoanStatus.NEW, LoanStatus.NEW)).toBe(false);
  });

  it('getAvailableTransitions включва конфигурираните + REJECTED_BY_CLIENT', () => {
    expect(service.getAvailableTransitions(LoanStatus.NEW).sort()).toEqual(
      [LoanStatus.COLLECTING_INFO, LoanStatus.REJECTED_BY_CLIENT].sort(),
    );
    expect(
      service.getAvailableTransitions(LoanStatus.INTERNAL_PROCESSING).sort(),
    ).toEqual(
      [
        LoanStatus.COLLECTING_INFO,
        LoanStatus.READY_FOR_BANK,
        LoanStatus.REJECTED_BY_CLIENT,
      ].sort(),
    );
    expect(
      service.getAvailableTransitions(LoanStatus.REJECTED_BY_CLIENT),
    ).toEqual([]);
  });
});

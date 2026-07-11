import { BadRequestException, Injectable } from '@nestjs/common';
import { LoanStatus } from '@prisma/client';

/**
 * Explicit state machine — преходите са конфигурация, не код.
 * Точно копие на workflow-а от MASTER_CONTEXT.
 */
const TRANSITIONS: Record<LoanStatus, readonly LoanStatus[]> = {
  [LoanStatus.NEW]: [LoanStatus.COLLECTING_INFO],
  [LoanStatus.COLLECTING_INFO]: [
    LoanStatus.WAITING_CLIENT,
    LoanStatus.INTERNAL_PROCESSING,
  ],
  [LoanStatus.WAITING_CLIENT]: [
    LoanStatus.COLLECTING_INFO,
    LoanStatus.INTERNAL_PROCESSING,
  ],
  [LoanStatus.INTERNAL_PROCESSING]: [
    LoanStatus.COLLECTING_INFO, // връщане за корекция
    LoanStatus.READY_FOR_BANK,
  ],
  [LoanStatus.READY_FOR_BANK]: [LoanStatus.SENT_TO_BANKS],
  [LoanStatus.SENT_TO_BANKS]: [LoanStatus.OFFERS_RECEIVED],
  [LoanStatus.OFFERS_RECEIVED]: [LoanStatus.OFFER_SELECTED],
  [LoanStatus.OFFER_SELECTED]: [LoanStatus.APPLICATION_SUBMITTED],
  [LoanStatus.APPLICATION_SUBMITTED]: [
    LoanStatus.APPROVED,
    LoanStatus.REJECTED_BY_BANK,
  ],
  [LoanStatus.APPROVED]: [LoanStatus.DISBURSED],
  [LoanStatus.REJECTED_BY_BANK]: [
    LoanStatus.SENT_TO_BANKS, // повторно изпращане
    LoanStatus.REJECTED_BY_CLIENT,
  ],
  [LoanStatus.REJECTED_BY_CLIENT]: [],
  [LoanStatus.DISBURSED]: [LoanStatus.COMPLETED],
  [LoanStatus.COMPLETED]: [],
};

@Injectable()
export class WorkflowService {
  canTransition(from: LoanStatus, to: LoanStatus): boolean {
    if (from === to) {
      return false;
    }
    // ANY_STATUS → REJECTED_BY_CLIENT (MASTER_CONTEXT)
    if (to === LoanStatus.REJECTED_BY_CLIENT) {
      return true;
    }
    return TRANSITIONS[from].includes(to);
  }

  /** Хвърля BadRequestException с ясно съобщение при невалиден преход. */
  assertTransition(from: LoanStatus, to: LoanStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Invalid status transition ${from} → ${to}. ` +
          `Allowed from ${from}: ${this.getAvailableTransitions(from).join(', ') || '(none)'}`,
      );
    }
  }

  getAvailableTransitions(from: LoanStatus): LoanStatus[] {
    const configured = [...TRANSITIONS[from]];
    if (
      from !== LoanStatus.REJECTED_BY_CLIENT &&
      !configured.includes(LoanStatus.REJECTED_BY_CLIENT)
    ) {
      configured.push(LoanStatus.REJECTED_BY_CLIENT);
    }
    return configured;
  }
}

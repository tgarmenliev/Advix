import { Module } from '@nestjs/common';
import { FinancialCalculationService } from './financial/financial-calculation.service';
import { LoanApplicationsController } from './loan-applications.controller';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

@Module({
  controllers: [LoanApplicationsController],
  providers: [
    LoanApplicationsService,
    WorkflowService,
    FinancialCalculationService,
  ],
  exports: [
    LoanApplicationsService,
    WorkflowService,
    FinancialCalculationService,
  ],
})
export class LoanApplicationsModule {}

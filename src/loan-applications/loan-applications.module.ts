import { Module } from '@nestjs/common';
import { LoanApplicationsController } from './loan-applications.controller';
import { LoanApplicationsService } from './loan-applications.service';
import { WorkflowService } from './workflow/workflow.service';

@Module({
  controllers: [LoanApplicationsController],
  providers: [LoanApplicationsService, WorkflowService],
  exports: [LoanApplicationsService, WorkflowService],
})
export class LoanApplicationsModule {}

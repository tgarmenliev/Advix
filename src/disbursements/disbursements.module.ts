import { Module } from '@nestjs/common';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { DisbursementsController } from './disbursements.controller';
import { DisbursementsService } from './disbursements.service';

@Module({
  imports: [LoanApplicationsModule],
  controllers: [DisbursementsController],
  providers: [DisbursementsService],
  exports: [DisbursementsService],
})
export class DisbursementsModule {}

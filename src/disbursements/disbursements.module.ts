import { Module } from '@nestjs/common';
import { CommissionSchemesModule } from '../commission-schemes/commission-schemes.module';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { DisbursementsController } from './disbursements.controller';
import { DisbursementsService } from './disbursements.service';

@Module({
  imports: [LoanApplicationsModule, CommissionSchemesModule],
  controllers: [DisbursementsController],
  providers: [DisbursementsService],
  exports: [DisbursementsService],
})
export class DisbursementsModule {}

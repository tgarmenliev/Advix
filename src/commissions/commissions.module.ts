import { Module } from '@nestjs/common';
import { CommissionSchemesModule } from '../commission-schemes/commission-schemes.module';
import { DisbursementsModule } from '../disbursements/disbursements.module';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { CommissionAdjustmentsService } from './commission-adjustments.service';
import { CommissionCalculationService } from './commission-calculation.service';
import { CommissionReportsService } from './commission-reports.service';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { PartnerCommissionService } from './partner-commission.service';

@Module({
  imports: [
    CommissionSchemesModule,
    DisbursementsModule,
    LoanApplicationsModule,
  ],
  controllers: [CommissionsController],
  providers: [
    CommissionsService,
    CommissionCalculationService,
    PartnerCommissionService,
    CommissionAdjustmentsService,
    CommissionReportsService,
  ],
  exports: [
    CommissionsService,
    CommissionCalculationService,
    PartnerCommissionService,
    CommissionAdjustmentsService,
    CommissionReportsService,
  ],
})
export class CommissionsModule {}

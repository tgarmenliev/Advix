import { Module } from '@nestjs/common';
import { CommissionSchemesModule } from '../commission-schemes/commission-schemes.module';
import { DisbursementsModule } from '../disbursements/disbursements.module';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { CommissionCalculationService } from './commission-calculation.service';
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
  ],
  exports: [
    CommissionsService,
    CommissionCalculationService,
    PartnerCommissionService,
  ],
})
export class CommissionsModule {}

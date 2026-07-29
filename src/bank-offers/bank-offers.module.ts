import { Module } from '@nestjs/common';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { BankOffersController } from './bank-offers.controller';
import { BankOffersService } from './bank-offers.service';
import { OfferComparisonService } from './offer-comparison.service';

@Module({
  imports: [LoanApplicationsModule],
  controllers: [BankOffersController],
  providers: [BankOffersService, OfferComparisonService],
  exports: [BankOffersService, OfferComparisonService],
})
export class BankOffersModule {}

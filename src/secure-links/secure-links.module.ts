import { Module } from '@nestjs/common';
import { BankOffersModule } from '../bank-offers/bank-offers.module';
import { ClientsModule } from '../clients/clients.module';
import { EmailModule } from '../email/email.module';
import { FamilyMembersModule } from '../family-members/family-members.module';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { SecureLinkManagementController } from './secure-link-management.controller';
import { SecureLinkMiddleware } from './secure-link.middleware';
import { SecureLinksController } from './secure-links.controller';
import { SecureLinksService } from './secure-links.service';

@Module({
  imports: [
    LoanApplicationsModule,
    BankOffersModule,
    ClientsModule,
    FamilyMembersModule,
    EmailModule,
  ],
  controllers: [SecureLinksController, SecureLinkManagementController],
  providers: [SecureLinksService, SecureLinkMiddleware],
  exports: [SecureLinksService, SecureLinkMiddleware],
})
export class SecureLinksModule {}

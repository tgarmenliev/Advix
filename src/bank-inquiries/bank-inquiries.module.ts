import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { InquiryTemplatesModule } from '../inquiry-templates/inquiry-templates.module';
import { LoanApplicationsModule } from '../loan-applications/loan-applications.module';
import { BankInquiriesController } from './bank-inquiries.controller';
import { BankInquiriesService } from './bank-inquiries.service';

@Module({
  imports: [EmailModule, InquiryTemplatesModule, LoanApplicationsModule],
  controllers: [BankInquiriesController],
  providers: [BankInquiriesService],
  exports: [BankInquiriesService],
})
export class BankInquiriesModule {}

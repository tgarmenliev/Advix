import { Module } from '@nestjs/common';
import { InquiryTemplatesController } from './inquiry-templates.controller';
import { InquiryTemplatesService } from './inquiry-templates.service';

@Module({
  controllers: [InquiryTemplatesController],
  providers: [InquiryTemplatesService],
  exports: [InquiryTemplatesService],
})
export class InquiryTemplatesModule {}

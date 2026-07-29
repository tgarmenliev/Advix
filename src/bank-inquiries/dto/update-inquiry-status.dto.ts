import { InquiryStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateInquiryStatusDto {
  @IsEnum(InquiryStatus)
  status!: InquiryStatus;
}

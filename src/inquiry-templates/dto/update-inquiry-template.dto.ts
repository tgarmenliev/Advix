import { PartialType } from '@nestjs/mapped-types';
import { CreateInquiryTemplateDto } from './create-inquiry-template.dto';

export class UpdateInquiryTemplateDto extends PartialType(
  CreateInquiryTemplateDto,
) {}

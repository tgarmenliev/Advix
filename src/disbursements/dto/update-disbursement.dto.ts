import { PartialType } from '@nestjs/mapped-types';
import { CreateDisbursementDto } from './create-disbursement.dto';

export class UpdateDisbursementDto extends PartialType(
  CreateDisbursementDto,
) {}

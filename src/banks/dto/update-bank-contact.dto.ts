import { PartialType } from '@nestjs/mapped-types';
import { CreateBankContactDto } from './create-bank-contact.dto';

export class UpdateBankContactDto extends PartialType(CreateBankContactDto) {}

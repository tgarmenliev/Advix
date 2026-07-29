import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBankOfferDto } from './create-bank-offer.dto';

/** Банката и запитването не се сменят след записване — само параметрите. */
export class UpdateBankOfferDto extends PartialType(
  OmitType(CreateBankOfferDto, ['bankId', 'inquiryId'] as const),
) {}

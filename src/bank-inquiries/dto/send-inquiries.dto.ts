import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class SendInquiriesDto {
  /** Контактите (служители в банки), към които се праща запитването */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  bankContactIds!: string[];

  /** По избор: редактирана тема (иначе се взима от default шаблона) */
  @IsOptional()
  @IsString()
  subject?: string;

  /** По избор: редактирано тяло (иначе се взима от default шаблона) */
  @IsOptional()
  @IsString()
  body?: string;

  /** Коментар от посредника към банката (пази се в запитването) */
  @IsOptional()
  @IsString()
  consultantNote?: string;
}

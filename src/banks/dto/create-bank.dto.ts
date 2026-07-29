import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBankDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  contractNotes?: string;

  @IsOptional()
  @IsString()
  commissionNotes?: string;

  @IsOptional()
  @IsString()
  bonusNotes?: string;
}

import { IsNotEmpty, IsString } from 'class-validator';

export class CreateBankOfficeDto {
  @IsString()
  @IsNotEmpty()
  city!: string;
}

import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class LinkPropertyDto {
  @IsUUID()
  propertyId!: string;

  /** Пазарна цена в стотинки — специфична за връзката, не за самия имот */
  @IsOptional()
  @IsInt()
  @Min(1)
  marketValue?: number;

  /** В полза на коя банка е учредена ипотеката (ако вече е учредена) */
  @IsOptional()
  @IsUUID()
  mortgageBankId?: string;
}

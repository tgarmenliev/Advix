import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Редакция само на базови полета. Статусът се сменя през /transition,
 * а loanType — само от ADMIN през /change-type (рядък краен случай).
 */
export class UpdateLoanApplicationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number; // стотинки

  @IsOptional()
  @IsInt()
  @Min(1)
  termMonths?: number;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

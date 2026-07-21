import { IsUUID } from 'class-validator';

export class FlipBorrowerDto {
  /** Съдлъжникът, който да стане основен кредитоискател */
  @IsUUID()
  familyMemberId!: string;
}

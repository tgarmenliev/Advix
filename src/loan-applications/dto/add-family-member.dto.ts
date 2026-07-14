import { IsUUID } from 'class-validator';

export class AddFamilyMemberDto {
  @IsUUID()
  familyMemberId!: string;
}

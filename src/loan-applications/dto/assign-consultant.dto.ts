import { IsUUID } from 'class-validator';

export class AssignConsultantDto {
  /** Потребителят, който да поеме заявката като отговорен консултант */
  @IsUUID()
  consultantId!: string;
}

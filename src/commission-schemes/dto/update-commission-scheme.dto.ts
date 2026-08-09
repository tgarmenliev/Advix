import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateCommissionSchemeDto } from './create-commission-scheme.dto';

/**
 * Видът и категорията не се сменят след създаване — това би променило смисъла
 * на вече изчисленото. За друга комбинация се създава нова схема.
 */
export class UpdateCommissionSchemeDto extends PartialType(
  OmitType(CreateCommissionSchemeDto, ['schemeType', 'loanCategory'] as const),
) {}

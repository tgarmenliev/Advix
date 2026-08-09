import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { CommissionsService } from './commissions.service';
import { PeriodQueryDto } from './dto/period-query.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';

@Controller()
export class CommissionsController {
  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly loanApplicationsService: LoanApplicationsService,
  ) {}

  /** Преглед без запис — колко излиза за периода при текущите данни */
  @Roles(UserRole.ADMIN)
  @Get('banks/:bankId/commissions/preview')
  preview(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.commissionsService.preview(
      bankId,
      query.loanCategory,
      query.schemeType,
      query.at ? new Date(query.at) : undefined,
    );
  }

  /** Преизчислява и записва периода (обемът се мени със задна дата) */
  @Roles(UserRole.ADMIN)
  @Post('banks/:bankId/commissions/recalculate')
  recalculate(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.commissionsService.recalculate(
      bankId,
      query.loanCategory,
      query.schemeType,
      query.at ? new Date(query.at) : undefined,
    );
  }

  @Roles(UserRole.ADMIN)
  @Patch('tranche-commissions/:id/status')
  updateTrancheStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionStatusDto,
  ) {
    return this.commissionsService.updateTrancheStatus(
      id,
      dto.status,
      dto.actualAmount,
      dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    );
  }

  @Roles(UserRole.ADMIN)
  @Patch('bank-period-bonuses/:id/status')
  updateBonusStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionStatusDto,
  ) {
    return this.commissionsService.updateBonusStatus(
      id,
      dto.status,
      dto.actualAmount,
      dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    );
  }

  /** Комисионите по конкретна заявка — вижда ги и водещият консултант */
  @Roles(
    UserRole.ADMIN,
    UserRole.CONSULTANT,
    UserRole.PARTNER_B,
    UserRole.PARTNER_C,
  )
  @Get('loan-applications/:id/commissions')
  async findForApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    return this.commissionsService.findForApplication(id);
  }
}

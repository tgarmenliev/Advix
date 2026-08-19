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
import { periodByIndex } from '../commission-schemes/period.util';
import { CommissionAdjustmentsService } from './commission-adjustments.service';
import { CommissionReportsService } from './commission-reports.service';
import { CommissionsService } from './commissions.service';
import { PartnerCommissionService } from './partner-commission.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { PeriodQueryDto } from './dto/period-query.dto';
import { ProposePartnerCommissionDto } from './dto/propose-partner-commission.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';

@Controller()
export class CommissionsController {
  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly partnerCommissionService: PartnerCommissionService,
    private readonly adjustmentsService: CommissionAdjustmentsService,
    private readonly reportsService: CommissionReportsService,
    private readonly loanApplicationsService: LoanApplicationsService,
  ) {}

  /** Периодът за справка — само ако и трите параметъра са подадени */
  private periodFrom(query: ReportQueryDto) {
    return query.periodType && query.year && query.index
      ? periodByIndex(query.periodType, query.year, query.index)
      : undefined;
  }

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
      query.schemeId,
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
      query.schemeId,
    );
  }

  /**
   * Активните схеми за банка+вид+категория — ползва се, когато преглед/
   * преизчисление гръмне с "ambiguous, specify schemeId", за да покаже
   * консултантът от какво да избере (label-ите).
   */
  @Roles(UserRole.ADMIN)
  @Get('banks/:bankId/commissions/active-schemes')
  listActiveSchemes(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.commissionsService.listActiveSchemes(
      bankId,
      query.schemeType,
      query.loanCategory,
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

  // --- Комисиона към партньора ---

  /** Партньорът вижда своя дял по своята сделка */
  @Roles(
    UserRole.ADMIN,
    UserRole.CONSULTANT,
    UserRole.PARTNER_A,
    UserRole.PARTNER_B,
    UserRole.PARTNER_C,
  )
  @Get('loan-applications/:id/partner-commission')
  async getPartnerCommission(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    return this.partnerCommissionService.findForApplication(id);
  }

  /** Партньорът може да си предложи дела; ADMIN въвежда направо одобрен */
  @Roles(
    UserRole.ADMIN,
    UserRole.CONSULTANT,
    UserRole.PARTNER_A,
    UserRole.PARTNER_B,
    UserRole.PARTNER_C,
  )
  @Post('loan-applications/:id/partner-commission')
  async proposePartnerCommission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposePartnerCommissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    return this.partnerCommissionService.propose(id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Patch('loan-applications/:id/partner-commission/approve')
  approvePartnerCommission(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnerCommissionService.approve(id, user);
  }

  @Roles(UserRole.ADMIN)
  @Patch('loan-applications/:id/partner-commission/reject')
  rejectPartnerCommission(@Param('id', ParseUUIDPipe) id: string) {
    return this.partnerCommissionService.reject(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('loan-applications/:id/partner-commission/pay')
  payPartnerCommission(@Param('id', ParseUUIDPipe) id: string) {
    return this.partnerCommissionService.pay(id);
  }

  /** Преизчислява дела при променени данни (обем, процент от банката) */
  @Roles(UserRole.ADMIN)
  @Patch('loan-applications/:id/partner-commission/recalculate')
  recalculatePartnerCommission(@Param('id', ParseUUIDPipe) id: string) {
    return this.partnerCommissionService.recalculate(id);
  }

  // --- Корекции и clawback ---

  @Roles(UserRole.ADMIN)
  @Post('banks/:bankId/commission-adjustments')
  createAdjustment(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adjustmentsService.create(bankId, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Get('banks/:bankId/commission-adjustments')
  listAdjustments(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query('outstanding') outstanding?: string,
  ) {
    return this.adjustmentsService.findAllForBank(
      bankId,
      outstanding === 'true',
    );
  }

  /** Отбелязва корекцията като приспадната от плащане */
  @Roles(UserRole.ADMIN)
  @Patch('commission-adjustments/:id/settle')
  settleAdjustment(@Param('id', ParseUUIDPipe) id: string) {
    return this.adjustmentsService.settle(id);
  }

  // --- Справки ---

  /** Общ преглед по банки: очаквано, получено, корекции, нетен приход */
  @Roles(UserRole.ADMIN)
  @Get('commissions/report')
  portfolioReport(@Query() query: ReportQueryDto) {
    return this.reportsService.portfolio(this.periodFrom(query));
  }

  @Roles(UserRole.ADMIN)
  @Get('banks/:bankId/commissions/report')
  bankReport(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.bankSummary(
      bankId,
      undefined,
      this.periodFrom(query),
    );
  }

  /** Кой партньор колко чака да получи и колко вече е взел */
  @Roles(UserRole.ADMIN)
  @Get('commissions/report/partners')
  partnerReport() {
    return this.reportsService.byPartner();
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AddFamilyMemberDto } from './dto/add-family-member.dto';
import { AssignConsultantDto } from './dto/assign-consultant.dto';
import { ChangeLoanTypeDto } from './dto/change-loan-type.dto';
import { CreateLoanApplicationDto } from './dto/create-loan-application.dto';
import { FlipBorrowerDto } from './dto/flip-borrower.dto';
import { LinkPropertyDto } from './dto/link-property.dto';
import { ListLoanApplicationsQueryDto } from './dto/list-loan-applications-query.dto';
import { TransitionDto } from './dto/transition.dto';
import { UpdateLoanApplicationDto } from './dto/update-loan-application.dto';
import { FinancialCalculationService } from './financial/financial-calculation.service';
import { LoanApplicationsService } from './loan-applications.service';

@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_A,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller('loan-applications')
export class LoanApplicationsController {
  constructor(
    private readonly loanApplicationsService: LoanApplicationsService,
    private readonly financialCalculationService: FinancialCalculationService,
  ) {}

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'LoanApplication',
    entityIdSource: 'response',
  })
  @Post()
  create(
    @Body() dto: CreateLoanApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.create(dto, user);
  }

  @Get()
  findAll(
    @Query() query: ListLoanApplicationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.findAll(query, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.findOne(id, user);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoanApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.update(id, dto, user);
  }

  // Назначаване/прехвърляне на консултант — само ADMIN
  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Roles(UserRole.ADMIN)
  @Patch(':id/assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignConsultantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.assignConsultant(
      id,
      dto.consultantId,
      user,
    );
  }

  // Смяна на типа на кредита — рядък краен случай, само ADMIN
  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Roles(UserRole.ADMIN)
  @Patch(':id/change-type')
  changeType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeLoanTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.changeLoanType(id, dto.loanType, user);
  }

  // Размяна основен клиент ↔ съдлъжник (PARTNER_A не участва)
  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Roles(
    UserRole.ADMIN,
    UserRole.CONSULTANT,
    UserRole.PARTNER_B,
    UserRole.PARTNER_C,
  )
  @Post(':id/flip-borrower')
  flipBorrower(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlipBorrowerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.flipBorrower(
      id,
      dto.familyMemberId,
      user,
    );
  }

  @AuditLog({
    action: AuditAction.STATUS_CHANGE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Post(':id/transition')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.transition(id, dto, user);
  }

  // --- Свързани лица по заявката ---

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Post(':id/family-members')
  addFamilyMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFamilyMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.addFamilyMember(
      id,
      dto.familyMemberId,
      user,
    );
  }

  @Get(':id/family-members')
  listFamilyMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.listFamilyMembers(id, user);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Delete(':id/family-members/:familyMemberId')
  removeFamilyMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('familyMemberId', ParseUUIDPipe) familyMemberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.removeFamilyMember(
      id,
      familyMemberId,
      user,
    );
  }

  // --- Имоти по заявката ---

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Post(':id/properties')
  linkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkPropertyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.linkProperty(id, dto, user);
  }

  @Get(':id/properties')
  listProperties(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.listProperties(id, user);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Delete(':id/properties/:propertyId')
  unlinkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.unlinkProperty(id, propertyId, user);
  }

  // --- Финансово резюме (само информативно — не взема кредитни решения) ---

  // PARTNER_A не вижда пълното досие, CLIENT няма достъп изобщо
  @Roles(
    UserRole.ADMIN,
    UserRole.CONSULTANT,
    UserRole.PARTNER_B,
    UserRole.PARTNER_C,
  )
  @Get(':id/financial-summary')
  async financialSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    return this.financialCalculationService.getFinancialSummary(id);
  }
}

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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AddFamilyMemberDto } from './dto/add-family-member.dto';
import { CreateLoanApplicationDto } from './dto/create-loan-application.dto';
import { LinkPropertyDto } from './dto/link-property.dto';
import { FinancialCalculationService } from './financial/financial-calculation.service';
import { ListLoanApplicationsQueryDto } from './dto/list-loan-applications-query.dto';
import { TransitionDto } from './dto/transition.dto';
import { UpdateLoanApplicationDto } from './dto/update-loan-application.dto';
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

  @Post()
  create(
    @Body() dto: CreateLoanApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.create(dto, user);
  }

  @Get()
  findAll(@Query() query: ListLoanApplicationsQueryDto) {
    return this.loanApplicationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanApplicationsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoanApplicationDto,
  ) {
    return this.loanApplicationsService.update(id, dto);
  }

  @Post(':id/transition')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.loanApplicationsService.transition(id, dto, user);
  }

  // --- Свързани лица по заявката ---

  @Post(':id/family-members')
  addFamilyMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFamilyMemberDto,
  ) {
    return this.loanApplicationsService.addFamilyMember(
      id,
      dto.familyMemberId,
    );
  }

  @Get(':id/family-members')
  listFamilyMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanApplicationsService.listFamilyMembers(id);
  }

  @Delete(':id/family-members/:familyMemberId')
  removeFamilyMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('familyMemberId', ParseUUIDPipe) familyMemberId: string,
  ) {
    return this.loanApplicationsService.removeFamilyMember(
      id,
      familyMemberId,
    );
  }

  // --- Имоти по заявката ---

  @Post(':id/properties')
  linkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkPropertyDto,
  ) {
    return this.loanApplicationsService.linkProperty(id, dto);
  }

  @Get(':id/properties')
  listProperties(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanApplicationsService.listProperties(id);
  }

  @Delete(':id/properties/:propertyId')
  unlinkProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.loanApplicationsService.unlinkProperty(id, propertyId);
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
  financialSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.financialCalculationService.getFinancialSummary(id);
  }
}

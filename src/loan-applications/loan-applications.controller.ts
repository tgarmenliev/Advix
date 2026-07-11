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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateLoanApplicationDto } from './dto/create-loan-application.dto';
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
}

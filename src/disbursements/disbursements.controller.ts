import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DisbursementsService } from './disbursements.service';
import { CreateDisbursementDto } from './dto/create-disbursement.dto';
import { UpdateDisbursementDto } from './dto/update-disbursement.dto';

@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class DisbursementsController {
  constructor(private readonly disbursementsService: DisbursementsService) {}

  @Post('loan-applications/:id/disbursements')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDisbursementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.create(id, dto, user);
  }

  @Get('loan-applications/:id/disbursements')
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.findAllForApplication(id, user);
  }

  @Patch('disbursements/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisbursementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.update(id, dto, user);
  }

  @Delete('disbursements/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.remove(id, user);
  }
}

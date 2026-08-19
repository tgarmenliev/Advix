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
import { AuditAction, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
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

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'Disbursement',
    entityIdSource: 'response',
  })
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

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'Disbursement',
    entityIdSource: 'param',
  })
  @Patch('disbursements/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisbursementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.update(id, dto, user);
  }

  @AuditLog({
    action: AuditAction.DELETE,
    entityType: 'Disbursement',
    entityIdSource: 'param',
  })
  @Delete('disbursements/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disbursementsService.remove(id, user);
  }
}

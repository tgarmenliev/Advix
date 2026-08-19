import {
  Body,
  Controller,
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
import { BankInquiriesService } from './bank-inquiries.service';
import { SendInquiriesDto } from './dto/send-inquiries.dto';
import { UpdateInquiryStatusDto } from './dto/update-inquiry-status.dto';

// PARTNER_A не изпраща към банки и не участва тук; CLIENT — никога
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class BankInquiriesController {
  constructor(private readonly bankInquiriesService: BankInquiriesService) {}

  // Преглед на запитването с попълнени данни (преди изпращане)
  @Get('loan-applications/:id/inquiry-preview')
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankInquiriesService.preview(id, user);
  }

  @AuditLog({
    action: AuditAction.INQUIRY_SENT,
    entityType: 'LoanApplication',
    entityIdSource: 'param',
  })
  @Post('loan-applications/:id/inquiries')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInquiriesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankInquiriesService.send(id, dto, user);
  }

  @Get('loan-applications/:id/inquiries')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankInquiriesService.listForApplication(id, user);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'BankInquiry',
    entityIdSource: 'param',
  })
  @Patch('bank-inquiries/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInquiryStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankInquiriesService.updateStatus(id, dto.status, user);
  }
}

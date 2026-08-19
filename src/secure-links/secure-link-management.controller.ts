import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, UserRole } from '@prisma/client';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { EmailService } from '../email/email.service';
import { LoanApplicationsService } from '../loan-applications/loan-applications.service';
import { CreateSecureLinkDto } from './dto/create-secure-link.dto';
import { SecureLinksService } from './secure-links.service';

/**
 * Административна повърхност (JWT + роля) за управление на Secure Links —
 * отделен контролер от публичния SecureLinksController нарочно: различен
 * охранителен модел (тук важи обичайният @Roles()), по-лесно за преглед, че
 * нищо публично не изтича случайно тук и обратно.
 */
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class SecureLinkManagementController {
  constructor(
    private readonly secureLinksService: SecureLinksService,
    private readonly loanApplicationsService: LoanApplicationsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'SecureLink',
    entityIdSource: 'response',
  })
  @Post('loan-applications/:id/secure-links')
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSecureLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    const { link, rawToken, recipientEmail } =
      await this.secureLinksService.create(id, dto, user);

    const baseUrl = this.configService.get<string>('appBaseUrl');
    const url = `${baseUrl}/secure/${rawToken}`;

    let emailSent = false;
    if (recipientEmail) {
      const result = await this.emailService.send({
        to: recipientEmail,
        subject: 'Достъп до Вашата кредитна заявка',
        body: [
          'Здравейте,',
          '',
          'Моля отворете следния линк, за да продължите:',
          url,
          '',
          `Линкът е валиден до ${link.expiresAt.toISOString()}.`,
        ].join('\n'),
      });
      emailSent = result.delivered || result.dryRun;
    }

    return { id: link.id, url, expiresAt: link.expiresAt, emailSent };
  }

  @Get('loan-applications/:id/secure-links')
  async findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.loanApplicationsService.assertAccessById(id, user);
    return this.secureLinksService.findAllForApplication(id);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'SecureLink',
    entityIdSource: 'param',
    entityIdParam: 'linkId',
  })
  @Patch('secure-links/:linkId/revoke')
  revoke(@Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.secureLinksService.revoke(linkId);
  }
}

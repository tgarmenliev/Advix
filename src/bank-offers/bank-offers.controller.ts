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
import { AuditAction, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BankOffersService } from './bank-offers.service';
import { CompareOffersQueryDto } from './dto/compare-offers-query.dto';
import { CreateBankOfferDto } from './dto/create-bank-offer.dto';
import { UpdateBankOfferDto } from './dto/update-bank-offer.dto';

// Същите роли като при банковите запитвания; PARTNER_A и CLIENT не участват
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class BankOffersController {
  constructor(private readonly bankOffersService: BankOffersService) {}

  @AuditLog({
    action: AuditAction.OFFER_RECEIVED,
    entityType: 'BankOffer',
    entityIdSource: 'response',
  })
  @Post('loan-applications/:id/offers')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBankOfferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.create(id, dto, user);
  }

  @Get('loan-applications/:id/offers')
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.findAllForApplication(id, user);
  }

  /** Сравнение рамо до рамо. Подреждане само по изричен `?sortBy=`. */
  @Get('loan-applications/:id/offers/comparison')
  compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CompareOffersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.compare(id, query, user);
  }

  @Get('bank-offers/:id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.findOne(id, user);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'BankOffer',
    entityIdSource: 'param',
  })
  @Patch('bank-offers/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankOfferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.update(id, dto, user);
  }

  /** Отбелязва избора на клиента (клиентът избира сам през Secure Link — фаза 9) */
  @AuditLog({
    action: AuditAction.OFFER_SELECTED,
    entityType: 'BankOffer',
    entityIdSource: 'param',
  })
  @Post('bank-offers/:id/select')
  select(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankOffersService.select(id, user);
  }
}

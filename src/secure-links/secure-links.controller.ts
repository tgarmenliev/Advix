import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import { Public } from '../common/decorators/public.decorator';
import { BankOffersService } from '../bank-offers/bank-offers.service';
import { OfferComparisonService } from '../bank-offers/offer-comparison.service';
import { ClientsService } from '../clients/clients.service';
import { PrismaService } from '../database/prisma.service';
import { FamilyMembersService } from '../family-members/family-members.service';
import { CurrentSecureLink } from './decorators/current-secure-link.decorator';
import { UpdateOwnClientProfileDto } from './dto/update-own-client-profile.dto';
import type { SecureLinkRequestContext } from './interfaces/secure-link-context.interface';
import { CLOSED_FOR_CLIENT_STATUSES } from './secure-links.service';
import { SecureLinksService } from './secure-links.service';

interface PersonalSubject {
  firstName: string;
  lastName: string | null;
  egn: string | null;
  email: string | null;
  phone: string | null;
  employer: string | null;
  jobTitle: string | null;
  contractType: string | null;
  netSalary: number | null;
  existingLoansTotal: number | null;
  existingLoansMonthlyTotal: number | null;
  gdprConsentAt: Date | null;
}

const CLIENT_SUBJECT_SELECT = {
  firstName: true,
  lastName: true,
  egn: true,
  email: true,
  phone: true,
  employer: true,
  jobTitle: true,
  contractType: true,
  netSalary: true,
  existingLoansTotal: true,
  existingLoansMonthlyTotal: true,
  gdprConsentAt: true,
} as const;

const FAMILY_MEMBER_SUBJECT_SELECT = CLIENT_SUBJECT_SELECT;

/**
 * Публична, клиентска повърхност — БЕЗ JWT, БЕЗ роля. Единствената защита е
 * SecureLinkMiddleware (валидация на токена + отваряне на tenant контекст).
 * Всеки отговор тук е РЪЧНО скроен DTO/select — никога суров Prisma обект,
 * защото тук няма ролева граница на приватност, каквато има навсякъде другаде.
 */
@Public()
@Controller('secure')
export class SecureLinksController {
  constructor(
    private readonly secureLinksService: SecureLinksService,
    private readonly prismaService: PrismaService,
    private readonly clientsService: ClientsService,
    private readonly familyMembersService: FamilyMembersService,
    private readonly bankOffersService: BankOffersService,
    private readonly offerComparisonService: OfferComparisonService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @Get(':token')
  async getStatus(@CurrentSecureLink() link: SecureLinkRequestContext) {
    const application = await this.db.loanApplication.findUnique({
      where: { id: link.loanApplicationId },
      select: { id: true, loanType: true, amount: true, termMonths: true, status: true },
    });
    if (!application) {
      throw new NotFoundException('Invalid secure link');
    }

    const subject = link.clientId
      ? await this.db.client.findUnique({
          where: { id: link.clientId },
          select: CLIENT_SUBJECT_SELECT,
        })
      : await this.db.familyMember.findUnique({
          where: { id: link.familyMemberId! },
          select: FAMILY_MEMBER_SUBJECT_SELECT,
        });
    if (!subject) {
      throw new NotFoundException('Invalid secure link');
    }

    const applicationOpen = !CLOSED_FOR_CLIENT_STATUSES.includes(
      application.status,
    );
    const offers = await this.bankOffersService.findAllForApplicationSecureLink(
      application.id,
    );

    return {
      loanApplication: application,
      subject: {
        kind: link.clientId ? 'client' : 'familyMember',
        firstName: subject.firstName,
        lastName: subject.lastName,
        data: subject,
      },
      actions: {
        canEditProfile: applicationOpen,
        missingFields: this.missingPersonalFields(subject),
        canGiveGdprConsent: applicationOpen && !subject.gdprConsentAt,
        canSelectOffer: application.status === 'OFFERS_RECEIVED',
        offers:
          offers.length > 0
            ? this.offerComparisonService.compare(offers)
            : null,
      },
    };
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    // entityType не се задава — извежда се динамично (Client/FamilyMember)
    // от req.secureLinkContext, виж decorator-а.
    entityIdSource: 'secureLinkSubject',
  })
  @Patch(':token/profile')
  async updateProfile(
    @CurrentSecureLink() link: SecureLinkRequestContext,
    // ЕДИН конкретен клас, НЕ TS union — NestJS ValidationPipe разчита на
    // reflect-metadata за да знае какъв клас да инстанцира/валидира; union
    // тип се "изтрива" до generic Object при компилация и ValidationPipe
    // тихо ПРЕСКАЧА валидация за Object metatype — whitelist/forbidNonWhitelisted
    // никога не се прилагат. (Открито на живо: gdprConsentAt минаваше
    // необезпокоявано въпреки че не е в нито един от двата DTO класа.)
    @Body() dto: UpdateOwnClientProfileDto,
  ) {
    if (link.clientId) {
      return this.clientsService.update(link.clientId, dto);
    }
    // FamilyMember няма canProvideIncomeProof/canTransferSalary/familySize —
    // изричен избор на съвместимото подмножество, не суров spread.
    const {
      canProvideIncomeProof: _canProvideIncomeProof,
      canTransferSalary: _canTransferSalary,
      familySize: _familySize,
      ...familyMemberDto
    } = dto;
    return this.familyMembersService.update(
      link.familyMemberId!,
      familyMemberDto,
    );
  }

  @AuditLog({
    action: AuditAction.OFFER_SELECTED,
    entityType: 'BankOffer',
    entityIdSource: 'param',
    entityIdParam: 'offerId',
  })
  @Post(':token/offers/:offerId/select')
  async selectOffer(
    @CurrentSecureLink() link: SecureLinkRequestContext,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    const result = await this.bankOffersService.selectForSecureLink(
      offerId,
      link.loanApplicationId,
    );
    await this.secureLinksService.markUsed(link.id);
    return result;
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityIdSource: 'secureLinkSubject',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':token/gdpr-consent')
  async giveGdprConsent(@CurrentSecureLink() link: SecureLinkRequestContext) {
    const result = link.clientId
      ? await this.db.client.update({
          where: { id: link.clientId },
          data: { gdprConsentAt: new Date() },
          select: { id: true, gdprConsentAt: true },
        })
      : await this.db.familyMember.update({
          where: { id: link.familyMemberId! },
          data: { gdprConsentAt: new Date() },
          select: { id: true, gdprConsentAt: true },
        });
    await this.secureLinksService.markUsed(link.id);
    return result;
  }

  private missingPersonalFields(subject: PersonalSubject): string[] {
    const missing: string[] = [];
    if (!subject.egn) missing.push('egn');
    if (subject.netSalary == null) missing.push('netSalary');
    if (!subject.contractType) missing.push('contractType');
    if (!subject.gdprConsentAt) missing.push('gdprConsentAt');
    return missing;
  }
}

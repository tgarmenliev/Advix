import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoanStatus, SecureLink, SecureLinkStatus } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { CreateSecureLinkDto } from './dto/create-secure-link.dto';
import { generateSecureToken, hashSecureToken } from './util/secure-token.util';

const DEFAULT_EXPIRY_HOURS = 7 * 24; // 7 дни

/** Заявката вече не е отворена за клиентско действие. */
export const CLOSED_FOR_CLIENT_STATUSES: readonly LoanStatus[] = [
  LoanStatus.DISBURSED,
  LoanStatus.COMPLETED,
  LoanStatus.REJECTED_BY_CLIENT,
  LoanStatus.REJECTED_BY_BANK,
];

export interface CreatedSecureLink {
  link: SecureLink;
  rawToken: string;
  recipientEmail: string | null;
}

/**
 * Управлява жизнения цикъл на Secure Link — създаване, резолюция по токен,
 * отмяна. Пази се в tenant schema-та (пълния запис), но резолюцията по токен
 * минава първо през public.SecureLinkIndex (виж resolveTenantForToken) —
 * нямаме tenantId, докато не открием индекса.
 *
 * Индексът в public и записа в tenant schema-та НЕ се пишат в обща
 * транзакция (различни connections по конструкция на schema-per-tenant
 * модела) — при рядък edge case (единия запис успее, другия не) линкът
 * просто не работи (fail closed), никога не работи погрешно/несигурно.
 */
@Injectable()
export class SecureLinksService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  /** Вика се от SecureLinkMiddleware — БЕЗ активен tenant контекст още. */
  async resolveTenantForToken(
    tokenHash: string,
  ): Promise<{ tenantId: string; schemaName: string } | null> {
    const indexEntry =
      await this.prismaService.publicDb.secureLinkIndex.findUnique({
        where: { tokenHash },
      });
    if (!indexEntry) {
      return null;
    }
    const tenant = await this.prismaService.publicDb.tenant.findUnique({
      where: { id: indexEntry.tenantId },
    });
    if (!tenant || !tenant.isActive) {
      return null;
    }
    return { tenantId: tenant.id, schemaName: tenant.schemaName };
  }

  /**
   * Пълна валидация, вече В рамките на отворен tenant контекст. EXPIRED и
   * REVOKED винаги блокират (проверява се на живо срещу expiresAt, не се
   * разчита само на кеширания статус); ACTIVE/USED са и двете използваеми.
   */
  async resolveActiveLink(tokenHash: string): Promise<SecureLink> {
    const link = await this.db.secureLink.findUnique({ where: { tokenHash } });
    if (!link || link.status === SecureLinkStatus.REVOKED) {
      throw new NotFoundException('Invalid secure link');
    }
    if (link.expiresAt.getTime() < Date.now()) {
      if (link.status !== SecureLinkStatus.EXPIRED) {
        await this.db.secureLink.update({
          where: { id: link.id },
          data: { status: SecureLinkStatus.EXPIRED },
        });
      }
      throw new NotFoundException('Invalid secure link');
    }
    return link;
  }

  /**
   * Създава линк за (получател × заявка). Автоматично отменя предходния
   * активен линк за СЪЩИЯ получател по СЪЩАТА заявка — един валиден линк
   * наведнъж, по модел на смяната на CommissionScheme (затваряш старото,
   * отваряш ново), не трупане на неясно кой е "текущият".
   */
  async create(
    loanApplicationId: string,
    dto: CreateSecureLinkDto,
    currentUser: AuthenticatedUser,
  ): Promise<CreatedSecureLink> {
    const hasClient = Boolean(dto.clientId);
    const hasFamilyMember = Boolean(dto.familyMemberId);
    if (hasClient === hasFamilyMember) {
      throw new BadRequestException(
        'Exactly one of clientId or familyMemberId must be provided',
      );
    }

    const application = await this.db.loanApplication.findUnique({
      where: { id: loanApplicationId },
    });
    if (!application) {
      throw new NotFoundException('Loan application not found');
    }

    let recipientEmail: string | null;
    if (dto.clientId) {
      if (dto.clientId !== application.clientId) {
        throw new BadRequestException(
          'clientId must be the client on this loan application',
        );
      }
      const client = await this.db.client.findUnique({
        where: { id: dto.clientId },
        select: { email: true },
      });
      recipientEmail = client?.email ?? null;
    } else {
      const membership = await this.db.loanApplicationFamilyMember.findUnique(
        {
          where: {
            loanApplicationId_familyMemberId: {
              loanApplicationId,
              familyMemberId: dto.familyMemberId!,
            },
          },
        },
      );
      if (!membership) {
        throw new BadRequestException(
          'familyMemberId must be a co-borrower on this loan application',
        );
      }
      const familyMember = await this.db.familyMember.findUnique({
        where: { id: dto.familyMemberId! },
        select: { email: true },
      });
      recipientEmail = familyMember?.email ?? null;
    }

    const rawToken = generateSecureToken();
    const tokenHash = hashSecureToken(rawToken);
    const expiresAt = new Date(
      Date.now() +
        (dto.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
    );

    const link = await this.db.$transaction(async (tx) => {
      await tx.secureLink.updateMany({
        where: {
          loanApplicationId,
          clientId: dto.clientId ?? null,
          familyMemberId: dto.familyMemberId ?? null,
          status: { in: [SecureLinkStatus.ACTIVE, SecureLinkStatus.USED] },
        },
        data: { status: SecureLinkStatus.REVOKED },
      });

      return tx.secureLink.create({
        data: {
          tokenHash,
          loanApplicationId,
          createdByUserId: currentUser.userId,
          clientId: dto.clientId,
          familyMemberId: dto.familyMemberId,
          purpose: dto.purpose,
          expiresAt,
        },
      });
    });

    await this.prismaService.publicDb.secureLinkIndex.create({
      data: { tokenHash, tenantId: currentUser.tenantId },
    });

    return { link, rawToken, recipientEmail };
  }

  async findAllForApplication(
    loanApplicationId: string,
  ): Promise<SecureLink[]> {
    return this.db.secureLink.findMany({
      where: { loanApplicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(linkId: string): Promise<SecureLink> {
    const link = await this.db.secureLink.findUnique({
      where: { id: linkId },
    });
    if (!link) {
      throw new NotFoundException('Secure link not found');
    }
    return this.db.secureLink.update({
      where: { id: linkId },
      data: { status: SecureLinkStatus.REVOKED },
    });
  }

  /** Информативен сигнал за първо терминално действие — не блокира нищо. */
  async markUsed(linkId: string): Promise<void> {
    await this.db.secureLink.updateMany({
      where: { id: linkId, usedAt: null },
      data: { usedAt: new Date(), status: SecureLinkStatus.USED },
    });
  }
}

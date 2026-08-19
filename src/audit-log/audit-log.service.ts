import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditLog, Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type {
  AuthenticatedUser,
  JwtAccessPayload,
} from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import type { SecureLinkRequestContext } from '../secure-links/interfaces/secure-link-context.interface';
import { AuditLogOptions } from './decorators/audit-log.decorator';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { getPath } from './util/get-path.util';

type ModelDelegate = {
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
};

export interface PaginatedAuditLogs {
  data: AuditLog[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface AuditRecordParams {
  options: AuditLogOptions;
  request: Request;
  currentUser?: AuthenticatedUser;
  secureLink?: SecureLinkRequestContext;
  /** entityId, ако вече е известен преди handler-а ('param' / 'currentUser' / 'secureLinkSubject'). */
  preloadedEntityId?: string;
  oldState: unknown;
  responseBody: unknown;
}

/**
 * Извършва действителния запис в AuditLog. Изнесено от интерцептора в отделен
 * сервиз, за да е тестваемо изолирано от HTTP плъмбинга.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Снимка на текущото състояние ПРЕДИ промяната. User живее само в "public" —
   * всичко останало е tenant-скопирано. Best-effort: грешка тук не бива да
   * пречи на самата бизнес операция.
   */
  async snapshot(entityType: string, entityId: string): Promise<unknown> {
    try {
      const db: PrismaClient =
        entityType === 'User' ? this.prisma.publicDb : this.prisma.tenantDb;
      const model = entityType.charAt(0).toLowerCase() + entityType.slice(1);
      const delegate = (db as unknown as Record<string, ModelDelegate>)[
        model
      ];
      const record = await delegate?.findUnique({ where: { id: entityId } });
      return record ?? null;
    } catch (error) {
      this.logger.error(
        `Audit snapshot failed for ${entityType}:${entityId}`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Записва реда в AuditLog. Best-effort — извикващият (интерцепторът) хваща
   * всяка грешка оттук и никога не я пропуска към клиента.
   */
  async record(params: AuditRecordParams): Promise<void> {
    const { options, request, currentUser, secureLink, oldState, responseBody } =
      params;
    let entityId = params.preloadedEntityId;

    if (options.entityIdSource === 'response') {
      entityId = getPath(responseBody, options.entityIdParam ?? 'id');
    }

    let userId: string | undefined;
    let secureLinkId: string | undefined;
    let db: PrismaClient;

    if (currentUser) {
      // Нормален, вече tenant-скопиран маршрут — AuditLog живее само в tenant schema.
      userId = currentUser.userId;
      db = this.prisma.tenantDb;
    } else if (secureLink) {
      // Клиент/съдлъжник през Secure Link — няма User, контекстът вече е
      // отворен от SecureLinkMiddleware, независимо от entityIdSource.
      secureLinkId = secureLink.id;
      db = this.prisma.tenantDb;
    } else if (options.entityIdSource === 'accessTokenClaims') {
      // login/refresh: няма req.user (маршрутът е @Public()) — четем claims-ите
      // от ЩЕ-издадения access token в отговора (вече подписан от нас, decode
      // без верификация е достатъчен само за четене на claim-овете).
      const accessToken = getPath(responseBody, 'accessToken');
      if (!accessToken) {
        this.logger.warn('Audit: accessToken missing from response, skipping');
        return;
      }
      const claims = this.jwtService.decode<JwtAccessPayload>(accessToken);
      if (!claims?.sub || !claims.tenantId) {
        this.logger.warn('Audit: could not decode access token claims');
        return;
      }
      entityId = claims.sub;
      userId = claims.sub;
      db = await this.resolveTenantClient(claims.tenantId);
    } else {
      // login: entityIdSource='response' + tenantIdParam сочи tenantId в отговора.
      const tenantId = options.tenantIdParam
        ? getPath(responseBody, options.tenantIdParam)
        : undefined;
      if (!tenantId || !entityId) {
        this.logger.warn('Audit: missing tenantId/entityId for pre-auth route');
        return;
      }
      userId = entityId;
      db = await this.resolveTenantClient(tenantId);
    }

    if (!entityId || !options.entityType || (!userId && !secureLinkId)) {
      this.logger.warn(
        `Audit: could not resolve entityId/entityType/actor for ${options.entityType}/${options.action}`,
      );
      return;
    }

    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        secureLinkId: secureLinkId ?? null,
        action: options.action,
        entityType: options.entityType,
        entityId,
        oldState: (oldState ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: {
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
      },
    });
  }

  /** Преглед за ADMIN — само записите на текущия tenant (tenantDb). */
  async findAll(query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogs> {
    const { page, limit, entityType, entityId, userId, loanApplicationId, from, to } =
      query;

    const where: Prisma.AuditLogWhereInput = {
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      ...(userId && { userId }),
      ...(loanApplicationId && { loanApplicationId }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const db = this.prisma.tenantDb;
    const [data, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async resolveTenantClient(tenantId: string): Promise<PrismaClient> {
    const tenant = await this.prisma.publicDb.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new Error(`Audit: unknown tenant ${tenantId}`);
    }
    return this.prisma.getClientForSchema(tenant.schemaName);
  }
}

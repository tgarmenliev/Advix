import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { SecureLinkRequestContext } from '../secure-links/interfaces/secure-link-context.interface';
import { AuditLogService } from './audit-log.service';
import { AUDIT_LOG_KEY, AuditLogOptions } from './decorators/audit-log.decorator';

/**
 * Глобален интерцептор — регистриран веднъж през APP_INTERCEPTOR, никога не се
 * извиква ръчно от бизнес логиката. Маршрутите БЕЗ @AuditLog() (включително
 * всички GET) минават без никакъв допълнителен DB достъп.
 *
 * За маркираните маршрути: снима oldState ПРЕДИ handler-а (когато entityId е
 * известен от route параметър, текущия потребител или Secure Link-а), после —
 * само при успешен отговор — записва реда. Записът е best-effort: грешка тук
 * никога не бива да развали реалната бизнес операция.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const options = this.reflector.get<AuditLogOptions | undefined>(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );
    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<
      Request & { secureLinkContext?: SecureLinkRequestContext }
    >();
    const currentUser = request.user as AuthenticatedUser | undefined;
    const secureLink = request.secureLinkContext;

    let preloadedEntityId: string | undefined;
    let resolvedEntityType = options.entityType;
    if (options.entityIdSource === 'param') {
      preloadedEntityId = request.params[options.entityIdParam ?? 'id'] as
        | string
        | undefined;
    } else if (options.entityIdSource === 'currentUser') {
      preloadedEntityId = currentUser?.userId;
    } else if (options.entityIdSource === 'secureLinkSubject' && secureLink) {
      preloadedEntityId = secureLink.clientId ?? secureLink.familyMemberId ?? undefined;
      resolvedEntityType = secureLink.clientId ? 'Client' : 'FamilyMember';
    }

    const oldState =
      preloadedEntityId && resolvedEntityType
        ? await this.auditLogService.snapshot(resolvedEntityType, preloadedEntityId)
        : null;

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        void this.auditLogService
          .record({
            options: { ...options, entityType: resolvedEntityType },
            request,
            currentUser,
            secureLink,
            preloadedEntityId,
            oldState,
            responseBody,
          })
          .catch((error: Error) => {
            this.logger.error('Audit log write failed', error.stack);
          });
      }),
    );
  }
}

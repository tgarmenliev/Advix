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
import { AuditLogService } from './audit-log.service';
import { AUDIT_LOG_KEY, AuditLogOptions } from './decorators/audit-log.decorator';

/**
 * Глобален интерцептор — регистриран веднъж през APP_INTERCEPTOR, никога не се
 * извиква ръчно от бизнес логиката. Маршрутите БЕЗ @AuditLog() (включително
 * всички GET) минават без никакъв допълнителен DB достъп.
 *
 * За маркираните маршрути: снима oldState ПРЕДИ handler-а (когато entityId е
 * известен от route параметър или от текущия потребител), после — само при
 * успешен отговор — записва реда. Записът е best-effort: грешка тук никога
 * не бива да развали реалната бизнес операция.
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

    const request = context.switchToHttp().getRequest<Request>();
    const currentUser = request.user as AuthenticatedUser | undefined;

    let preloadedEntityId: string | undefined;
    if (options.entityIdSource === 'param') {
      preloadedEntityId = request.params[options.entityIdParam ?? 'id'] as
        | string
        | undefined;
    } else if (options.entityIdSource === 'currentUser') {
      preloadedEntityId = currentUser?.userId;
    }

    const oldState = preloadedEntityId
      ? await this.auditLogService.snapshot(options.entityType, preloadedEntityId)
      : null;

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        void this.auditLogService
          .record({
            options,
            request,
            currentUser,
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

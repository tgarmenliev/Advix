import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from '../database/tenant-context.service';
import { SecureLinkRequestContext } from './interfaces/secure-link-context.interface';
import { SecureLinksService } from './secure-links.service';
import { hashSecureToken } from './util/secure-token.util';

/**
 * Аналог на TenantMiddleware, но за клиенти без JWT — стартира от гол токен
 * в URL-а вместо от Authorization header. Middleware, НЕ Guard: контекстът
 * трябва да обвие целия последващ pipeline (interceptors, handler), а Guard
 * няма тази възможност.
 *
 * Прилага се само върху secure/* маршрутите (виж app.module.ts) — тези
 * маршрути са едновременно изключени от TenantMiddleware (PUBLIC_ROUTES) и
 * маркирани @Public() (bypass на JwtAuthGuard).
 */
@Injectable()
export class SecureLinkMiddleware implements NestMiddleware {
  constructor(
    private readonly secureLinksService: SecureLinksService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = this.extractToken(req);
    if (!token) {
      throw new NotFoundException('Invalid secure link');
    }
    const tokenHash = hashSecureToken(token);

    const tenant = await this.secureLinksService.resolveTenantForToken(
      tokenHash,
    );
    if (!tenant) {
      throw new NotFoundException('Invalid secure link');
    }

    await this.tenantContext.run(
      { tenantId: tenant.tenantId, schemaName: tenant.schemaName },
      async () => {
        const link = await this.secureLinksService.resolveActiveLink(
          tokenHash,
        );
        const context: SecureLinkRequestContext = {
          id: link.id,
          loanApplicationId: link.loanApplicationId,
          clientId: link.clientId,
          familyMemberId: link.familyMemberId,
        };
        (req as Request & { secureLinkContext: SecureLinkRequestContext }).secureLinkContext =
          context;
        next();
      },
    );
  }

  /** URL-ът е винаги /secure/:token[...] — не разчитаме на req.params (не са
   *  винаги налични на middleware ниво), четем директно от пътя. */
  private extractToken(req: Request): string | undefined {
    const match = /^\/secure\/([^/]+)/.exec(req.path);
    return match?.[1];
  }
}

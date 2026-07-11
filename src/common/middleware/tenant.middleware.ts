import {
  Injectable,
  NestMiddleware,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../database/tenant-context.service';

/**
 * Публични endpoints — не изискват tenant контекст.
 * Използват се и от AppModule за .exclude() при регистрацията на middleware-а.
 */
export const PUBLIC_ROUTES: RouteInfo[] = [
  { path: 'auth/login', method: RequestMethod.POST },
  { path: 'auth/refresh', method: RequestMethod.POST },
  { path: 'health', method: RequestMethod.GET },
  // Secure Links — фаза 9
  { path: 'secure/:token', method: RequestMethod.GET },
];

/**
 * При всяка (непублична) заявка:
 * 1. Извлича tenantId от JWT токена в Authorization header
 * 2. Зарежда Tenant от public schema
 * 3. Обвива остатъка от request-а в tenantContext.run(...) —
 *    целият downstream код вижда правилната schema през AsyncLocalStorage
 *
 * Публичните endpoints (auth/login, auth/refresh, health, secure/:token)
 * са изключени при регистрацията в AppModule.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Защита в дълбочина — публичните маршрути са изключени и в AppModule
    if (this.isPublicRoute(req)) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }
    const token = authHeader.slice('Bearer '.length).trim();

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload.tenantId) {
      throw new UnauthorizedException('Token does not contain a tenant');
    }

    const tenant = await this.prismaService.publicDb.tenant.findUnique({
      where: { id: payload.tenantId },
    });

    if (!tenant || !tenant.isActive) {
      throw new UnauthorizedException('Unknown or inactive tenant');
    }

    this.tenantContext.run(
      { tenantId: tenant.id, schemaName: tenant.schemaName },
      () => next(),
    );
  }

  private isPublicRoute(req: Request): boolean {
    return PUBLIC_ROUTES.some((route) => {
      if (RequestMethod[route.method] !== req.method) {
        return false;
      }
      const pattern = new RegExp(
        `^/${route.path.replace(/:[^/]+/g, '[^/]+')}/?$`,
      );
      return pattern.test(req.path);
    });
  }
}

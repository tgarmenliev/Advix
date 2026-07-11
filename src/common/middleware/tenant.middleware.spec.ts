import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../database/tenant-context.service';
import { TenantMiddleware } from './tenant.middleware';

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;
  let tenantContext: TenantContextService;

  const tenantFindUnique = jest.fn();

  const prismaMock = {
    get publicDb() {
      return { tenant: { findUnique: tenantFindUnique } };
    },
  };

  const jwtMock = {
    verifyAsync: jest.fn(),
  };

  const configMock = {
    getOrThrow: jest.fn(() => 'access-secret-that-is-at-least-32-chars'),
  };

  const res = {} as Response;

  const makeRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      method: 'GET',
      path: '/clients',
      headers: { authorization: 'Bearer some.jwt.token' },
      ...overrides,
    }) as unknown as Request;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantMiddleware,
        TenantContextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    middleware = moduleRef.get(TenantMiddleware);
    tenantContext = moduleRef.get(TenantContextService);
  });

  it('обвива next() в tenant контекст при валиден JWT с намерен tenant', async () => {
    jwtMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@test.bg',
      role: 'ADMIN',
    });
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Test Tenant',
      schemaName: 'tenant_test',
      isActive: true,
    });

    let schemaInsideRequest: string | undefined;
    const next = jest.fn(() => {
      // Симулира downstream handler — трябва да вижда tenant контекста
      schemaInsideRequest = tenantContext.getSchemaName();
    }) as NextFunction;

    await middleware.use(makeRequest(), res, next);

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
    });
    expect(next).toHaveBeenCalled();
    expect(schemaInsideRequest).toBe('tenant_test');
    // Контекстът не изтича извън request-а
    expect(tenantContext.hasContext()).toBe(false);
  });

  it('хвърля UnauthorizedException при JWT с несъществуващ tenantId', async () => {
    jwtMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'missing-tenant',
      email: 'admin@test.bg',
      role: 'ADMIN',
    });
    tenantFindUnique.mockResolvedValue(null);
    const next = jest.fn() as NextFunction;

    await expect(
      middleware.use(makeRequest(), res, next),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('хвърля UnauthorizedException при неактивен tenant', async () => {
    jwtMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@test.bg',
      role: 'ADMIN',
    });
    tenantFindUnique.mockResolvedValue({
      id: 'tenant-1',
      schemaName: 'tenant_test',
      isActive: false,
    });
    const next = jest.fn() as NextFunction;

    await expect(
      middleware.use(makeRequest(), res, next),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('хвърля UnauthorizedException при липсващ Authorization header', async () => {
    const next = jest.fn() as NextFunction;

    await expect(
      middleware.use(
        makeRequest({ headers: {} } as Partial<Request>),
        res,
        next,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('не се изпълнява за публичен endpoint', async () => {
    const next = jest.fn() as NextFunction;
    const req = makeRequest({
      method: 'POST',
      path: '/auth/login',
      headers: {},
    } as Partial<Request>);

    await middleware.use(req, res, next);

    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

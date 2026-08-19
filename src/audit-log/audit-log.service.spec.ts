import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { AuditLogOptions } from './decorators/audit-log.decorator';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const auditLog = { create: jest.fn(), findMany: jest.fn(), count: jest.fn() };
  const client = { findUnique: jest.fn() };
  const user = { findUnique: jest.fn() };
  const tenant = { findUnique: jest.fn() };
  const tenantDb = { auditLog, client };
  const publicDb = { user, tenant };
  const getClientForSchema = jest.fn();

  const prismaMock = {
    get tenantDb() {
      return tenantDb;
    },
    get publicDb() {
      return publicDb;
    },
    getClientForSchema,
  };

  const jwtMock = { decode: jest.fn() };

  const request = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' }, params: {} } as unknown as Request;

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'a@test.bg',
    role: 'ADMIN' as AuthenticatedUser['role'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    auditLog.create.mockResolvedValue({ id: 'log-1' });
    getClientForSchema.mockReturnValue(tenantDb);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
      ],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  describe('snapshot', () => {
    it('чете от tenantDb за обикновен entityType', async () => {
      client.findUnique.mockResolvedValue({ id: 'c-1', firstName: 'Иван' });
      const result = await service.snapshot('Client', 'c-1');
      expect(client.findUnique).toHaveBeenCalledWith({ where: { id: 'c-1' } });
      expect(result).toEqual({ id: 'c-1', firstName: 'Иван' });
    });

    it('чете от publicDb за User (живее само там)', async () => {
      user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@test.bg' });
      const result = await service.snapshot('User', 'u-1');
      expect(user.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' } });
      expect(client.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'u-1', email: 'a@test.bg' });
    });

    it('връща null при грешка вместо да гърми (best-effort)', async () => {
      client.findUnique.mockRejectedValue(new Error('boom'));
      const result = await service.snapshot('Client', 'c-1');
      expect(result).toBeNull();
    });
  });

  describe('record — нормален tenant-скопиран маршрут', () => {
    it('entityIdSource=param — пише в tenantDb с userId от currentUser', async () => {
      const options: AuditLogOptions = {
        action: 'UPDATE' as AuditLogOptions['action'],
        entityType: 'Client',
        entityIdSource: 'param',
      };
      await service.record({
        options,
        request,
        currentUser,
        preloadedEntityId: 'c-1',
        oldState: { firstName: 'Иван' },
        responseBody: { id: 'c-1', firstName: 'Петър' },
      });

      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'UPDATE',
          entityType: 'Client',
          entityId: 'c-1',
          oldState: { firstName: 'Иван' },
          metadata: { ip: '10.0.0.1', userAgent: 'jest' },
        }),
      });
    });

    it('entityIdSource=response — взима entityId от тялото на отговора', async () => {
      const options: AuditLogOptions = {
        action: 'CREATE' as AuditLogOptions['action'],
        entityType: 'Client',
        entityIdSource: 'response',
      };
      await service.record({
        options,
        request,
        currentUser,
        oldState: null,
        responseBody: { id: 'c-new' },
      });

      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityId: 'c-new', userId: 'user-1' }),
        }),
      );
    });

    it('secureLink контекст (клиент без User) — userId=null, secureLinkId попълнен', async () => {
      const options: AuditLogOptions = {
        action: 'UPDATE' as AuditLogOptions['action'],
        entityType: 'Client',
        entityIdSource: 'secureLinkSubject',
      };
      await service.record({
        options,
        request,
        currentUser: undefined,
        secureLink: {
          id: 'link-1',
          clientId: 'client-1',
          familyMemberId: null,
          loanApplicationId: 'app-1',
        },
        preloadedEntityId: 'client-1',
        oldState: null,
        responseBody: {},
      });

      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          secureLinkId: 'link-1',
          entityId: 'client-1',
          entityType: 'Client',
        }),
      });
    });
  });

  describe('record — маршрути без активен tenant контекст (login/refresh)', () => {
    it('accessTokenClaims (refresh) — декодира accessToken за userId+tenant, пише в правилната схема', async () => {
      jwtMock.decode.mockReturnValue({ sub: 'user-9', tenantId: 'tenant-9' });
      tenant.findUnique.mockResolvedValue({ id: 'tenant-9', schemaName: 'tenant_x' });

      const options: AuditLogOptions = {
        action: 'REFRESH_TOKEN' as AuditLogOptions['action'],
        entityType: 'User',
        entityIdSource: 'accessTokenClaims',
      };
      await service.record({
        options,
        request,
        currentUser: undefined,
        oldState: null,
        responseBody: { accessToken: 'signed.jwt.token' },
      });

      expect(jwtMock.decode).toHaveBeenCalledWith('signed.jwt.token');
      expect(tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant-9' } });
      expect(getClientForSchema).toHaveBeenCalledWith('tenant_x');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-9', entityId: 'user-9' }),
        }),
      );
    });

    it('response + tenantIdParam (login) — намира tenantId в тялото на отговора', async () => {
      tenant.findUnique.mockResolvedValue({ id: 'tenant-9', schemaName: 'tenant_x' });

      const options: AuditLogOptions = {
        action: 'LOGIN' as AuditLogOptions['action'],
        entityType: 'User',
        entityIdSource: 'response',
        entityIdParam: 'user.id',
        tenantIdParam: 'user.tenantId',
      };
      await service.record({
        options,
        request,
        currentUser: undefined,
        oldState: null,
        responseBody: { user: { id: 'user-5', tenantId: 'tenant-9' } },
      });

      expect(getClientForSchema).toHaveBeenCalledWith('tenant_x');
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-5', entityId: 'user-5' }),
        }),
      );
    });

    it('без accessToken в отговора — прескача записа тихо, не хвърля', async () => {
      const options: AuditLogOptions = {
        action: 'REFRESH_TOKEN' as AuditLogOptions['action'],
        entityType: 'User',
        entityIdSource: 'accessTokenClaims',
      };
      await service.record({
        options,
        request,
        currentUser: undefined,
        oldState: null,
        responseBody: {},
      });
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('филтрира и странира от tenantDb', async () => {
      auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 2,
        limit: 10,
        entityType: 'Client',
      });

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'Client' },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    });
  });
});

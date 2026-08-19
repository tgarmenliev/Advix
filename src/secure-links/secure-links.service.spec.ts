import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SecureLinkStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { SecureLinksService } from './secure-links.service';

describe('SecureLinksService', () => {
  let service: SecureLinksService;

  const secureLink = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const loanApplication = { findUnique: jest.fn() };
  const client = { findUnique: jest.fn() };
  const familyMember = { findUnique: jest.fn() };
  const loanApplicationFamilyMember = { findUnique: jest.fn() };
  const tenantDb = {
    secureLink,
    loanApplication,
    client,
    familyMember,
    loanApplicationFamilyMember,
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tenantDb)),
  };

  const secureLinkIndex = { findUnique: jest.fn(), create: jest.fn() };
  const tenant = { findUnique: jest.fn() };
  const publicDb = { secureLinkIndex, tenant };

  const prismaMock = {
    get tenantDb() {
      return tenantDb;
    },
    get publicDb() {
      return publicDb;
    },
  };

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'a@test.bg',
    role: UserRole.CONSULTANT,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tenantDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(tenantDb),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecureLinksService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(SecureLinksService);
  });

  describe('resolveTenantForToken', () => {
    it('връща tenant при валиден и активен индекс', async () => {
      secureLinkIndex.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
      tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        isActive: true,
        schemaName: 'tenant_x',
      });
      const result = await service.resolveTenantForToken('hash-1');
      expect(result).toEqual({ tenantId: 'tenant-1', schemaName: 'tenant_x' });
    });

    it('връща null при непознат хеш', async () => {
      secureLinkIndex.findUnique.mockResolvedValue(null);
      expect(await service.resolveTenantForToken('hash-x')).toBeNull();
    });

    it('връща null при неактивен tenant', async () => {
      secureLinkIndex.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
      tenant.findUnique.mockResolvedValue({ id: 'tenant-1', isActive: false });
      expect(await service.resolveTenantForToken('hash-1')).toBeNull();
    });
  });

  describe('resolveActiveLink', () => {
    it('връща валиден ACTIVE линк', async () => {
      secureLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: SecureLinkStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const link = await service.resolveActiveLink('hash-1');
      expect(link.id).toBe('link-1');
    });

    it('хвърля 404 за REVOKED, дори преди срока', async () => {
      secureLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: SecureLinkStatus.REVOKED,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.resolveActiveLink('hash-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('хвърля 404 и маркира EXPIRED при изтекъл срок', async () => {
      secureLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: SecureLinkStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resolveActiveLink('hash-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(secureLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { status: SecureLinkStatus.EXPIRED },
      });
    });

    it('хвърля 404 при непознат токен', async () => {
      secureLink.findUnique.mockResolvedValue(null);
      await expect(service.resolveActiveLink('hash-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const dto = { clientId: 'client-1' };

    beforeEach(() => {
      loanApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-1',
      });
      client.findUnique.mockResolvedValue({ email: 'client@test.bg' });
      secureLink.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'link-new', ...data }),
      );
    });

    it('отхвърля когато липсват и clientId, и familyMemberId', async () => {
      await expect(
        service.create('app-1', {}, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('отхвърля когато и двете са подадени', async () => {
      await expect(
        service.create(
          'app-1',
          { clientId: 'client-1', familyMemberId: 'fm-1' },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('отхвърля clientId, който не е клиентът на заявката', async () => {
      await expect(
        service.create('app-1', { clientId: 'someone-else' }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('отхвърля familyMemberId, който не е съдлъжник по заявката', async () => {
      loanApplicationFamilyMember.findUnique.mockResolvedValue(null);
      await expect(
        service.create('app-1', { familyMemberId: 'fm-1' }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('затваря предходния активен линк за същия получател преди да създаде нов', async () => {
      await service.create('app-1', dto, currentUser);
      expect(secureLink.updateMany).toHaveBeenCalledWith({
        where: {
          loanApplicationId: 'app-1',
          clientId: 'client-1',
          familyMemberId: null,
          status: { in: [SecureLinkStatus.ACTIVE, SecureLinkStatus.USED] },
        },
        data: { status: SecureLinkStatus.REVOKED },
      });
    });

    it('пише индекса в public и връща rawToken + recipientEmail', async () => {
      const result = await service.create('app-1', dto, currentUser);
      expect(secureLinkIndex.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-1' }),
      });
      expect(result.rawToken).toEqual(expect.any(String));
      expect(result.recipientEmail).toBe('client@test.bg');
    });
  });

  describe('revoke', () => {
    it('хвърля 404 за непознат линк', async () => {
      secureLink.findUnique.mockResolvedValue(null);
      await expect(service.revoke('link-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('маркира REVOKED съществуващ линк', async () => {
      secureLink.findUnique.mockResolvedValue({ id: 'link-1' });
      secureLink.update.mockResolvedValue({
        id: 'link-1',
        status: SecureLinkStatus.REVOKED,
      });
      const result = await service.revoke('link-1');
      expect(result.status).toBe(SecureLinkStatus.REVOKED);
    });
  });

  describe('markUsed', () => {
    it('маркира usedAt/USED само ако все още не е използван', async () => {
      await service.markUsed('link-1');
      expect(secureLink.updateMany).toHaveBeenCalledWith({
        where: { id: 'link-1', usedAt: null },
        data: { usedAt: expect.any(Date), status: SecureLinkStatus.USED },
      });
    });
  });
});

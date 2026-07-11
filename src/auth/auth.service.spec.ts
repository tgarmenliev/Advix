import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;

  const mockUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@test.bg',
    passwordHash: 'hashed-password',
    firstName: 'Admin',
    lastName: 'Test',
    phone: null,
    role: UserRole.ADMIN,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    tokenVersion: 0,
    refreshTokenHash: 'stored-refresh-hash',
    commissionPercent: null,
    commissionFixed: null,
  };

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const jwtMock = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const configValues: Record<string, string> = {
    'jwt.accessSecret': 'access-secret-that-is-at-least-32-chars',
    'jwt.refreshSecret': 'refresh-secret-that-is-at-least-32-chars',
    'jwt.accessExpiresIn': '1h',
    'jwt.refreshExpiresIn': '30d',
  };

  const configMock = {
    getOrThrow: jest.fn((key: string) => {
      const value = configValues[key];
      if (value === undefined) {
        throw new Error(`Missing config key: ${key}`);
      }
      return value;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('връща токени при валидни credentials', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.user.update.mockResolvedValue(mockUser);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');
      jwtMock.signAsync
        .mockResolvedValueOnce('signed-access-token')
        .mockResolvedValueOnce('signed-refresh-token');

      const result = await service.login('admin@test.bg', 'Test1234!');

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: 'signed-refresh-token',
        user: {
          id: 'user-1',
          email: 'admin@test.bg',
          role: UserRole.ADMIN,
          tenantId: 'tenant-1',
        },
      });
      // Refresh токенът се пази само като hash
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: 'new-refresh-hash' },
      });
    });

    it('хвърля UnauthorizedException при невалидна парола', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('admin@test.bg', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtMock.signAsync).not.toHaveBeenCalled();
    });

    it('хвърля UnauthorizedException при несъществуващ email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('missing@test.bg', 'Test1234!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    });

    it('хвърля UnauthorizedException при деактивиран потребител', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login('admin@test.bg', 'Test1234!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('връща нов access token при валиден refresh token', async () => {
      jwtMock.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 0,
      });
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.user.update.mockResolvedValue(mockUser);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('rotated-hash');
      jwtMock.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      const result = await service.refresh('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      expect(jwtMock.verifyAsync).toHaveBeenCalledWith(
        'valid-refresh-token',
        expect.objectContaining({
          secret: configValues['jwt.refreshSecret'],
        }),
      );
    });

    it('хвърля UnauthorizedException при инвалидиран tokenVersion', async () => {
      jwtMock.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 0,
      });
      // logout е инкрементирал tokenVersion на 1 → токен с версия 0 е невалиден
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        tokenVersion: 1,
      });

      await expect(service.refresh('stale-refresh-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwtMock.signAsync).not.toHaveBeenCalled();
    });

    it('хвърля UnauthorizedException при невалиден JWT', async () => {
      jwtMock.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

      await expect(service.refresh('garbage')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('инкрементира tokenVersion и изтрива refresh token hash', async () => {
      prismaMock.user.update.mockResolvedValue({
        ...mockUser,
        tokenVersion: 1,
        refreshTokenHash: null,
      });

      await service.logout('user-1');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          tokenVersion: { increment: 1 },
          refreshTokenHash: null,
        },
      });
    });
  });
});

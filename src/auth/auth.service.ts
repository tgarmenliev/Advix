import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import {
  JwtAccessPayload,
  JwtRefreshPayload,
} from './interfaces/jwt-payload.interface';

export const BCRYPT_SALT_ROUNDS = 12;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    tenantId: string;
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** За Passport LocalStrategy — връща потребителя без passwordHash или null. */
  async validateUser(
    email: string,
    password: string,
  ): Promise<Omit<User, 'passwordHash' | 'refreshTokenHash'> | null> {
    const user = await this.prismaService.user.findUnique({
      where: { email },
    });
    if (!user || !user.isActive) {
      return null;
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return null;
    }
    const { passwordHash: _ph, refreshTokenHash: _rth, ...safeUser } = user;
    return safeUser;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prismaService.user.findUnique({
      where: { email },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.issueTokens(user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
        refreshToken,
        {
          secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    if (
      !user.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, user.refreshTokenHash))
    ) {
      throw new UnauthorizedException('Refresh token not recognized');
    }

    // Ротация: издаваме нов access + нов refresh token, старият става невалиден
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    // Инкрементирането на tokenVersion инвалидира всички активни refresh токени
    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        tokenVersion: { increment: 1 },
        refreshTokenHash: null,
      },
    });
  }

  async getProfile(
    userId: string,
  ): Promise<Omit<User, 'passwordHash' | 'refreshTokenHash'>> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    const { passwordHash: _ph, refreshTokenHash: _rth, ...safeUser } = user;
    return safeUser;
  }

  private async issueTokens(
    user: Pick<User, 'id' | 'tenantId' | 'email' | 'role' | 'tokenVersion'>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.configService.getOrThrow<string>(
          'jwt.accessExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.getOrThrow<string>(
          'jwt.refreshExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      }),
    ]);

    // Пази се само hash на refresh токена — никога plaintext
    const refreshTokenHash = await bcrypt.hash(
      refreshToken,
      BCRYPT_SALT_ROUNDS,
    );
    await this.prismaService.user.update({
      where: { id: user.id },
      data: { refreshTokenHash },
    });

    return { accessToken, refreshToken };
  }
}

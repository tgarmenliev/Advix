import { UserRole } from '@prisma/client';

/** Payload в JWT access token */
export interface JwtAccessPayload {
  sub: string; // userId
  tenantId: string;
  email: string;
  role: UserRole;
}

/** Payload в JWT refresh token */
export interface JwtRefreshPayload {
  sub: string; // userId
  tenantId: string;
  tokenVersion: number; // за инвалидиране на всички refresh токени
}

/** Потребителят, закачен на request-а от JwtStrategy */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  role: UserRole;
}

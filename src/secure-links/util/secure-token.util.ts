import { createHash, randomBytes } from 'node:crypto';

/**
 * Токенът, вграден в URL-а (напр. /secure/xxx) — 256 бита случайност,
 * НЕ uuid() (MASTER_CONTEXT §6). base64url е компактен и URL-safe без escaping.
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 на токена — пази се вместо суровата стойност, същия принцип като
 * User.refreshTokenHash. Не bcrypt: токенът вече е висока ентропия (256 бита),
 * няма нужда от сол като при пароли, а SHA-256 позволява бърз lookup по индекс.
 */
export function hashSecureToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

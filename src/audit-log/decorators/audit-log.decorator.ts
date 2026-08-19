import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

export const AUDIT_LOG_KEY = 'auditLog';

/**
 * Откъде идва entityId (и userId/tenantId, когато няма активен tenant контекст):
 * - 'param'            — от route параметър (entityIdParam, по подразбиране 'id')
 * - 'response'         — от тялото на отговора, dot-path (entityIdParam, по подразбиране 'id')
 * - 'currentUser'       — самият автентикиран потребител е засегнатият обект (напр. logout)
 * - 'accessTokenClaims' — декодира response.accessToken (login/refresh, преди tenant контекст)
 */
export type AuditEntityIdSource =
  | 'param'
  | 'response'
  | 'currentUser'
  | 'accessTokenClaims';

export interface AuditLogOptions {
  action: AuditAction;
  /** Prisma model име ("Client", "LoanApplication"...) — ползва се и за snapshot, и за записа. */
  entityType: string;
  entityIdSource: AuditEntityIdSource;
  /** 'param': име на route параметъра (default 'id'). 'response': dot-path (default 'id'). */
  entityIdParam?: string;
  /**
   * Само за 'response', когато entityType='User' и няма активен tenant контекст
   * (login) — dot-path в отговора към tenantId, за да се открие схемата за запис.
   */
  tenantIdParam?: string;
}

/**
 * Маркира маршрут за автоматично одитно логване от AuditLogInterceptor.
 * Немаркираните маршрути (включително всички GET) никога не се одитират —
 * интерцепторът излиза веднага без DB достъп.
 */
export const AuditLog = (options: AuditLogOptions) =>
  SetMetadata(AUDIT_LOG_KEY, options);

/**
 * Чете стойност по dot-path от произволен обект — напр. getPath(body, 'user.id').
 * Използва се за извличане на entityId/tenantId от response тялото, чиято форма
 * се декларира в @AuditLog(), не се извежда чрез reflection.
 */
export function getPath(source: unknown, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      source,
    );
  return typeof value === 'string' ? value : undefined;
}

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  schemaName: string;
}

/**
 * Request-scoped tenant контекст върху AsyncLocalStorage.
 *
 * TenantMiddleware обвива всеки request в run(), след което целият downstream
 * async call chain на този request вижда своя tenant контекст, без той да
 * "изтича" към паралелни requests — това е гаранцията срещу cross-tenant leak.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  /** Стартира нов tenant контекст за текущия request. */
  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }

  getTenantId(): string {
    return this.getContext().tenantId;
  }

  getSchemaName(): string {
    return this.getContext().schemaName;
  }

  private getContext(): TenantContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'No active tenant context — tenant-scoped operation outside of a tenant request',
      );
    }
    return context;
  }
}

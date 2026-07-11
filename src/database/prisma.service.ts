import {
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';

export const PUBLIC_SCHEMA = 'public';

// Позволени имена на tenant schema — защита срещу SQL injection през schema name
export const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Prisma Service без mutable schema state.
 *
 * Самият service (this / publicDb) е PrismaClient, закачен ЗАВИНАГИ към
 * "public" schema — глобалните таблици Tenant и User се четат само през него.
 *
 * Tenant-scoped операциите минават през getter-а `tenantDb`, който при ВСЕКИ
 * достъп чете schema-та от request-scoped TenantContextService
 * (AsyncLocalStorage) — паралелни requests от различни tenants не могат да си
 * влияят. PrismaClient инстанциите се кешират по schemaName (per-schema
 * connection pooling).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly databaseUrl: string;
  private readonly tenantClients = new Map<string, PrismaClient>();

  // PrismaClient v7 е Proxy — model делегатите (tenant, user...) съществуват
  // само върху proxy-то. В getter, извикан през proxy-то, `this` е суровият
  // target, затова улавяме proxy референцията веднъж в конструктора.
  private readonly publicClient: PrismaClient;

  constructor(
    configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    super({
      adapter: new PrismaPg(databaseUrl, { schema: PUBLIC_SCHEMA }),
    });
    this.databaseUrl = databaseUrl;
    this.publicClient = this;
  }

  /** PrismaClient за глобалните таблици (Tenant, User) — винаги public. */
  get publicDb(): PrismaClient {
    return this.publicClient;
  }

  /**
   * PrismaClient за tenant-скопирани таблици (Client, LoanApplication и т.н.).
   * Schema-та идва от AsyncLocalStorage контекста на текущия request.
   */
  get tenantDb(): PrismaClient {
    if (!this.tenantContext.hasContext()) {
      throw new InternalServerErrorException(
        'Tenant-scoped database access without an active tenant context',
      );
    }
    return this.getClientForSchema(this.tenantContext.getSchemaName());
  }

  /** Връща (или създава и кешира) PrismaClient за конкретна schema. */
  getClientForSchema(schema: string): PrismaClient {
    if (!SCHEMA_NAME_PATTERN.test(schema)) {
      throw new InternalServerErrorException('Invalid tenant schema name');
    }
    if (schema === PUBLIC_SCHEMA) {
      return this.publicClient;
    }
    let client = this.tenantClients.get(schema);
    if (!client) {
      client = new PrismaClient({
        adapter: new PrismaPg(this.databaseUrl, { schema }),
      });
      this.tenantClients.set(schema, client);
    }
    return client;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await Promise.all(
      [...this.tenantClients.values()].map((client) => client.$disconnect()),
    );
    this.tenantClients.clear();
  }
}

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tenant } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { PrismaService, SCHEMA_NAME_PATTERN } from '../database/prisma.service';

/**
 * Tenant provisioning.
 *
 * MVP подход (документиран съгласно фазовата задача):
 * 1. Създава Tenant запис в public schema
 * 2. CREATE SCHEMA "tenant_xxx"
 * 3. Изпълнява програмно всички migration.sql файлове от prisma/migrations/
 *    с search_path, сочещ новата schema — така tenant schema-та получава
 *    същата структура като public, без ръчно писани migrations
 * 4. Дропва копията на глобалните таблици Tenant/User от tenant schema-та
 *    (те живеят само в public; CASCADE маха FK-тата на LoanApplication/AuditLog/
 *    SecureLink към локалния User — тези колони остават като plain UUID връзки
 *    към public.User)
 *
 * Стъпки 2–4 са в една транзакция; при грешка schema-та не остава наполовина,
 * а Tenant записът се трие.
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly databaseUrl: string;

  constructor(
    private readonly prismaService: PrismaService,
    configService: ConfigService,
  ) {
    this.databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
  }

  async createTenant(name: string): Promise<Tenant> {
    const schemaName = `tenant_${randomBytes(6).toString('hex')}`;

    const tenant = await this.prismaService.publicDb.tenant.create({
      data: { name, schemaName },
    });

    try {
      await this.provisionSchema(schemaName);
    } catch (error) {
      await this.prismaService.publicDb.tenant.delete({
        where: { id: tenant.id },
      });
      this.logger.error(
        `Provisioning failed for schema ${schemaName}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Tenant schema provisioning failed',
      );
    }

    return tenant;
  }

  /** Създава PostgreSQL schema и прилага структурата от Prisma migrations. */
  async provisionSchema(schemaName: string): Promise<void> {
    if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
      throw new InternalServerErrorException('Invalid tenant schema name');
    }

    const migrationSqls = this.loadMigrationSqls();
    const pg = new PgClient({ connectionString: this.databaseUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query(`CREATE SCHEMA "${schemaName}"`);
      await pg.query(`SET LOCAL search_path TO "${schemaName}"`);
      for (const sql of migrationSqls) {
        await pg.query(sql);
      }
      // Глобалните таблици живеят само в public — виж class-level коментара
      await pg.query(`DROP TABLE IF EXISTS "${schemaName}"."User" CASCADE`);
      await pg.query(`DROP TABLE IF EXISTS "${schemaName}"."Tenant" CASCADE`);
      await pg.query('COMMIT');
    } catch (error) {
      await pg.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await pg.end();
    }
  }

  private loadMigrationSqls(): string[] {
    const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
    return readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((dir) => path.join(migrationsDir, dir, 'migration.sql'))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'));
  }
}

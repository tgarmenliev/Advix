import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [TenantContextService, PrismaService],
  exports: [TenantContextService, PrismaService],
})
export class DatabaseModule {}

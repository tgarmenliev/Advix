import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateTenantDto) {
    const tenant = await this.tenantsService.createTenant(dto.name);
    return {
      id: tenant.id,
      name: tenant.name,
      schemaName: tenant.schemaName,
    };
  }
}

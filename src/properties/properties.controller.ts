import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertiesService } from './properties.service';

@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'Property',
    entityIdSource: 'response',
  })
  @Post()
  create(@Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.propertiesService.findOne(id);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'Property',
    entityIdSource: 'param',
  })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(id, dto);
  }

  @AuditLog({
    action: AuditAction.DELETE,
    entityType: 'Property',
    entityIdSource: 'param',
  })
  @Roles(UserRole.ADMIN, UserRole.CONSULTANT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.propertiesService.delete(id);
  }
}

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
import { BanksService } from './banks.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { CreateBankOfficeDto } from './dto/create-bank-office.dto';
import { UpdateBankDto } from './dto/update-bank.dto';

// Всички роли (без CLIENT) четат; писането е само за ADMIN (виж отделните методи)
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_A,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'Bank',
    entityIdSource: 'response',
  })
  @Roles(UserRole.ADMIN)
  @Post('banks')
  create(@Body() dto: CreateBankDto) {
    return this.banksService.create(dto);
  }

  @Get('banks')
  findAll() {
    return this.banksService.findAll();
  }

  @Get('banks/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.banksService.findOne(id);
  }

  @AuditLog({
    action: AuditAction.UPDATE,
    entityType: 'Bank',
    entityIdSource: 'param',
  })
  @Roles(UserRole.ADMIN)
  @Patch('banks/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankDto,
  ) {
    return this.banksService.update(id, dto);
  }

  // --- Офиси (само ADMIN за писане) ---

  @AuditLog({
    action: AuditAction.CREATE,
    entityType: 'BankOffice',
    entityIdSource: 'response',
  })
  @Roles(UserRole.ADMIN)
  @Post('banks/:bankId/offices')
  addOffice(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: CreateBankOfficeDto,
  ) {
    return this.banksService.addOffice(bankId, dto);
  }

  @Get('banks/:bankId/offices')
  listOffices(@Param('bankId', ParseUUIDPipe) bankId: string) {
    return this.banksService.listOffices(bankId);
  }

  @AuditLog({
    action: AuditAction.DELETE,
    entityType: 'BankOffice',
    entityIdSource: 'param',
  })
  @Roles(UserRole.ADMIN)
  @Delete('bank-offices/:id')
  removeOffice(@Param('id', ParseUUIDPipe) id: string) {
    return this.banksService.removeOffice(id);
  }
}

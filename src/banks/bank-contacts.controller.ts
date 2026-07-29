import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BankContactsService } from './bank-contacts.service';
import { CreateBankContactDto } from './dto/create-bank-contact.dto';
import { ListBankContactsQueryDto } from './dto/list-bank-contacts-query.dto';
import { UpdateBankContactDto } from './dto/update-bank-contact.dto';

// Всички роли (без CLIENT) четат контактите и избират получатели;
// добавяне/редакция е за ADMIN и CONSULTANT
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_A,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class BankContactsController {
  constructor(private readonly bankContactsService: BankContactsService) {}

  @Roles(UserRole.ADMIN, UserRole.CONSULTANT)
  @Post('banks/:bankId/contacts')
  create(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: CreateBankContactDto,
  ) {
    return this.bankContactsService.create(bankId, dto);
  }

  @Get('banks/:bankId/contacts')
  findAllForBank(@Param('bankId', ParseUUIDPipe) bankId: string) {
    return this.bankContactsService.findAllForBank(bankId);
  }

  // Мек филтър по град — по подразбиране града на консултанта
  @Get('bank-contacts')
  findAll(
    @Query() query: ListBankContactsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankContactsService.findAll(query, user);
  }

  @Get('bank-contacts/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bankContactsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.CONSULTANT)
  @Patch('bank-contacts/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankContactDto,
  ) {
    return this.bankContactsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.CONSULTANT)
  @Delete('bank-contacts/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bankContactsService.remove(id);
  }
}

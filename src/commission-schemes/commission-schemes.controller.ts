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
import { Roles } from '../common/decorators/roles.decorator';
import { CommissionSchemesService } from './commission-schemes.service';
import { CreateCommissionSchemeDto } from './dto/create-commission-scheme.dto';
import { ResolveSchemeQueryDto } from './dto/resolve-scheme-query.dto';
import { UpdateCommissionSchemeDto } from './dto/update-commission-scheme.dto';

/**
 * Комисионните схеми са фирмена финансова конфигурация — само за администратор.
 */
@Roles(UserRole.ADMIN)
@Controller()
export class CommissionSchemesController {
  constructor(
    private readonly commissionSchemesService: CommissionSchemesService,
  ) {}

  @Post('banks/:bankId/commission-schemes')
  create(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: CreateCommissionSchemeDto,
  ) {
    return this.commissionSchemesService.create(bankId, dto);
  }

  @Get('banks/:bankId/commission-schemes')
  findAllForBank(@Param('bankId', ParseUUIDPipe) bankId: string) {
    return this.commissionSchemesService.findAllForBank(bankId);
  }

  /** Коя схема действа към дадена дата (по подразбиране — сега) */
  @Get('banks/:bankId/commission-schemes/active')
  resolveActive(
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Query() query: ResolveSchemeQueryDto,
  ) {
    return this.commissionSchemesService.resolveActive(
      bankId,
      query.schemeType,
      query.loanCategory,
      query.at ? new Date(query.at) : undefined,
    );
  }

  @Get('commission-schemes/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.commissionSchemesService.findOne(id);
  }

  @Patch('commission-schemes/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionSchemeDto,
  ) {
    return this.commissionSchemesService.update(id, dto);
  }

  @Delete('commission-schemes/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.commissionSchemesService.remove(id);
  }
}

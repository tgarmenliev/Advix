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
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';
import { FamilyMembersService } from './family-members.service';

/**
 * Маршрутите са на два префикса (вложени под /clients и плоски /family-members),
 * затова контролерът е без общ префикс и декларира пълните пътища.
 */
@Roles(
  UserRole.ADMIN,
  UserRole.CONSULTANT,
  UserRole.PARTNER_A,
  UserRole.PARTNER_B,
  UserRole.PARTNER_C,
)
@Controller()
export class FamilyMembersController {
  constructor(private readonly familyMembersService: FamilyMembersService) {}

  @Post('clients/:clientId/family-members')
  create(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateFamilyMemberDto,
  ) {
    return this.familyMembersService.create(clientId, dto);
  }

  @Get('clients/:clientId/family-members')
  findAllForClient(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.familyMembersService.findAllForClient(clientId);
  }

  @Get('family-members/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.familyMembersService.findOne(id);
  }

  @Patch('family-members/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFamilyMemberDto,
  ) {
    return this.familyMembersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.CONSULTANT)
  @Delete('family-members/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.familyMembersService.softDelete(id);
  }
}

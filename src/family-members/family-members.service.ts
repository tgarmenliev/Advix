import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FamilyMember } from '@prisma/client';
import { ageFromEgn } from '../common/validators/egn.util';
import { PrismaService } from '../database/prisma.service';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';

@Injectable()
export class FamilyMembersService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(
    clientId: string,
    dto: CreateFamilyMemberDto,
  ): Promise<FamilyMember> {
    const client = await this.db.client.findFirst({
      where: { id: clientId, deletedAt: null },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }

    await this.assertEgnUniqueForClient(clientId, dto.egn);

    const { gdprConsentAt, ...rest } = dto;
    return this.db.familyMember.create({
      data: {
        ...rest,
        clientId,
        // Същата логика като Client — възрастта се извежда от ЕГН
        age: ageFromEgn(dto.egn)!,
        ...(gdprConsentAt !== undefined && {
          gdprConsentAt: new Date(gdprConsentAt),
        }),
      },
    });
  }

  async findAllForClient(clientId: string): Promise<FamilyMember[]> {
    const client = await this.db.client.findFirst({
      where: { id: clientId, deletedAt: null },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return this.db.familyMember.findMany({
      where: { clientId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string): Promise<FamilyMember> {
    const member = await this.db.familyMember.findFirst({
      where: { id, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('Family member not found');
    }
    return member;
  }

  async update(id: string, dto: UpdateFamilyMemberDto): Promise<FamilyMember> {
    const existing = await this.findOne(id);

    if (dto.egn && dto.egn !== existing.egn) {
      await this.assertEgnUniqueForClient(existing.clientId, dto.egn);
    }

    const { gdprConsentAt, egn, ...rest } = dto;
    return this.db.familyMember.update({
      where: { id },
      data: {
        ...rest,
        ...(egn !== undefined && { egn, age: ageFromEgn(egn)! }),
        ...(gdprConsentAt !== undefined && {
          gdprConsentAt: new Date(gdprConsentAt),
        }),
      },
    });
  }

  /** Soft delete — лицето има лични/финансови данни, не се трие физически. */
  async softDelete(id: string): Promise<{ id: string; deletedAt: Date }> {
    await this.findOne(id);
    const deleted = await this.db.familyMember.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id: deleted.id, deletedAt: deleted.deletedAt! };
  }

  /**
   * Дедупликация: едно и също ЕГН не може да е добавено два пъти към СЪЩИЯ
   * клиент. (Същото лице може да е съдлъжник при друг клиент — това е валидно.)
   */
  private async assertEgnUniqueForClient(
    clientId: string,
    egn: string,
  ): Promise<void> {
    const existing = await this.db.familyMember.findFirst({
      where: { clientId, egn, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(
        `Family member with EGN ${egn} is already added to this client`,
      );
    }
  }
}

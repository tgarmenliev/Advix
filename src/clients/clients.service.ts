import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import { ageFromEgn } from '../common/validators/egn.util';
import { PrismaService } from '../database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';

export interface PaginatedClients {
  data: Client[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable()
export class ClientsService {
  constructor(private readonly prismaService: PrismaService) {}

  /** Клиентите живеят в tenant schema — достъп само през tenantDb. */
  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(dto: CreateClientDto): Promise<Client> {
    if (dto.egn) {
      await this.assertEgnUnique(dto.egn);
    }
    return this.db.client.create({
      data: this.toPersistence(dto),
    });
  }

  async findAll(query: ListClientsQueryDto): Promise<PaginatedClients> {
    const { page, limit, search } = query;

    const where: Prisma.ClientWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { egn: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.db.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.client.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Един клиент с досие (семейни членове, заявки, документи). */
  async findOne(id: string): Promise<Client> {
    const client = await this.db.client.findFirst({
      where: { id, deletedAt: null },
      include: {
        familyMembers: true,
        loanApplications: {
          orderBy: { createdAt: 'desc' },
        },
        documents: true,
      },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    const existing = await this.db.client.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    if (dto.egn && dto.egn !== existing.egn) {
      await this.assertEgnUnique(dto.egn);
    }

    return this.db.client.update({
      where: { id },
      data: this.toPersistence(dto),
    });
  }

  /** Soft delete — клиентът има финансови/правни данни, не се трие физически. */
  async softDelete(id: string): Promise<{ id: string; deletedAt: Date }> {
    const existing = await this.db.client.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Client not found');
    }
    const deleted = await this.db.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id: deleted.id, deletedAt: deleted.deletedAt! };
  }

  /** Дедупликация по ЕГН в рамките на tenant-а (вкл. soft-deleted записи). */
  private async assertEgnUnique(egn: string): Promise<void> {
    const existing = await this.db.client.findUnique({ where: { egn } });
    if (existing) {
      throw new ConflictException(
        `Client with EGN ${egn} already exists in this organization`,
      );
    }
  }

  /** Мапва DTO към данни за запис; age се изчислява автоматично от ЕГН. */
  private toPersistence(
    dto: CreateClientDto | UpdateClientDto,
  ): Prisma.ClientUpdateInput & Prisma.ClientCreateInput {
    const { gdprConsentAt, egn, ...rest } = dto;
    return {
      ...(rest as Prisma.ClientCreateInput),
      ...(egn !== undefined && { egn, age: ageFromEgn(egn) }),
      ...(gdprConsentAt !== undefined && {
        gdprConsentAt: new Date(gdprConsentAt),
      }),
    };
  }
}

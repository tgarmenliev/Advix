import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Bank, BankOffice, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateBankDto } from './dto/create-bank.dto';
import { CreateBankOfficeDto } from './dto/create-bank-office.dto';
import { UpdateBankDto } from './dto/update-bank.dto';

@Injectable()
export class BanksService {
  constructor(private readonly prismaService: PrismaService) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(dto: CreateBankDto): Promise<Bank> {
    try {
      return await this.db.bank.create({ data: dto });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Bank "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  findAll(): Promise<Bank[]> {
    return this.db.bank.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Bank> {
    const bank = await this.db.bank.findUnique({
      where: { id },
      include: { offices: true, contacts: true },
    });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }
    return bank;
  }

  async update(id: string, dto: UpdateBankDto): Promise<Bank> {
    await this.assertExists(id);
    try {
      return await this.db.bank.update({ where: { id }, data: dto });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Bank "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  // --- Офиси ---

  async addOffice(
    bankId: string,
    dto: CreateBankOfficeDto,
  ): Promise<BankOffice> {
    await this.assertExists(bankId);
    return this.db.bankOffice.create({ data: { bankId, city: dto.city } });
  }

  async listOffices(bankId: string): Promise<BankOffice[]> {
    await this.assertExists(bankId);
    return this.db.bankOffice.findMany({
      where: { bankId },
      orderBy: { city: 'asc' },
    });
  }

  async removeOffice(id: string): Promise<{ id: string; deleted: true }> {
    const office = await this.db.bankOffice.findUnique({ where: { id } });
    if (!office) {
      throw new NotFoundException('Bank office not found');
    }
    await this.db.bankOffice.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async assertExists(id: string): Promise<void> {
    const bank = await this.db.bank.findUnique({ where: { id } });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }
  }
}

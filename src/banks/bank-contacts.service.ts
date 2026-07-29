import { Injectable, NotFoundException } from '@nestjs/common';
import { BankContact, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateBankContactDto } from './dto/create-bank-contact.dto';
import { ListBankContactsQueryDto } from './dto/list-bank-contacts-query.dto';
import { UpdateBankContactDto } from './dto/update-bank-contact.dto';

@Injectable()
export class BankContactsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private get db() {
    return this.prismaService.tenantDb;
  }

  async create(
    bankId: string,
    dto: CreateBankContactDto,
  ): Promise<BankContact> {
    const bank = await this.db.bank.findUnique({ where: { id: bankId } });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }
    return this.db.bankContact.create({ data: { ...dto, bankId } });
  }

  /**
   * Мек филтър по град (MASTER_CONTEXT / спец. правило 4):
   *  - по подразбиране → контактите от града на текущия консултант;
   *  - `?allCities=true` → всички градове;
   *  - `?city=...` → изрично избран град.
   * Филтърът НЕ заключва — консултантът може да поиска всички по всяко време.
   */
  async findAll(
    query: ListBankContactsQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<BankContact[]> {
    const where: Prisma.BankContactWhereInput = {
      ...(query.bankId && { bankId: query.bankId }),
    };

    if (!query.allCities) {
      const city =
        query.city ??
        (await this.usersService.getCurrentUserCity(currentUser.userId));
      if (city) {
        where.city = city;
      }
    }

    return this.db.bankContact.findMany({
      where,
      include: { bank: { select: { id: true, name: true } } },
      orderBy: [{ city: 'asc' }, { lastName: 'asc' }],
    });
  }

  async findAllForBank(bankId: string): Promise<BankContact[]> {
    const bank = await this.db.bank.findUnique({ where: { id: bankId } });
    if (!bank) {
      throw new NotFoundException('Bank not found');
    }
    return this.db.bankContact.findMany({
      where: { bankId },
      orderBy: [{ city: 'asc' }, { lastName: 'asc' }],
    });
  }

  async findOne(id: string): Promise<BankContact> {
    const contact = await this.db.bankContact.findUnique({
      where: { id },
      include: { bank: { select: { id: true, name: true } } },
    });
    if (!contact) {
      throw new NotFoundException('Bank contact not found');
    }
    return contact;
  }

  async update(
    id: string,
    dto: UpdateBankContactDto,
  ): Promise<BankContact> {
    await this.findOne(id);
    return this.db.bankContact.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.findOne(id);
    await this.db.bankContact.delete({ where: { id } });
    return { id, deleted: true };
  }
}

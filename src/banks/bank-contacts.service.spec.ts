import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { BankContactsService } from './bank-contacts.service';

describe('BankContactsService — мек филтър по град', () => {
  let service: BankContactsService;

  const bankContact = { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() };
  const bank = { findUnique: jest.fn() };
  const prismaMock = {
    get tenantDb() {
      return { bankContact, bank };
    },
  };
  const usersMock = { getCurrentUserCity: jest.fn() };

  const consultant: AuthenticatedUser = {
    userId: 'consultant-1',
    tenantId: 'tenant-1',
    email: 'c@test.bg',
    role: UserRole.CONSULTANT,
  };

  const whereOf = () =>
    (bankContact.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;

  beforeEach(async () => {
    jest.clearAllMocks();
    bankContact.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BankContactsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: UsersService, useValue: usersMock },
      ],
    }).compile();
    service = moduleRef.get(BankContactsService);
  });

  it('по подразбиране филтрира по града на консултанта', async () => {
    usersMock.getCurrentUserCity.mockResolvedValue('Пловдив');
    await service.findAll({}, consultant);
    expect(whereOf().city).toBe('Пловдив');
  });

  it('allCities=true → без филтър по град', async () => {
    await service.findAll({ allCities: true }, consultant);
    expect(whereOf().city).toBeUndefined();
    expect(usersMock.getCurrentUserCity).not.toHaveBeenCalled();
  });

  it('изрично city override-ва града на консултанта', async () => {
    await service.findAll({ city: 'Варна' }, consultant);
    expect(whereOf().city).toBe('Варна');
    expect(usersMock.getCurrentUserCity).not.toHaveBeenCalled();
  });

  it('консултант без град → без филтър (вижда всички)', async () => {
    usersMock.getCurrentUserCity.mockResolvedValue(null);
    await service.findAll({}, consultant);
    expect(whereOf().city).toBeUndefined();
  });

  it('create хвърля NotFound при несъществуваща банка', async () => {
    bank.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing-bank', {
        firstName: 'Иван',
        lastName: 'Петров',
        email: 'i@bank.bg',
        city: 'София',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

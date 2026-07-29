import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BanksService } from './banks.service';

describe('BanksService', () => {
  let service: BanksService;

  const bank = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const bankOffice = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() };
  const prismaMock = {
    get tenantDb() {
      return { bank, bankOffice };
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BanksService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(BanksService);
  });

  it('създава банка', async () => {
    bank.create.mockResolvedValue({ id: 'b1', name: 'ОББ' });
    await service.create({ name: 'ОББ' });
    expect(bank.create).toHaveBeenCalledWith({ data: { name: 'ОББ' } });
  });

  it('дублирано име → ConflictException', async () => {
    bank.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '7',
      }),
    );
    await expect(service.create({ name: 'ОББ' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('findOne за несъществуваща банка → NotFound', async () => {
    bank.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('добавя офис към съществуваща банка', async () => {
    bank.findUnique.mockResolvedValue({ id: 'b1' });
    bankOffice.create.mockResolvedValue({ id: 'o1', city: 'Бургас' });
    await service.addOffice('b1', { city: 'Бургас' });
    expect(bankOffice.create).toHaveBeenCalledWith({
      data: { bankId: 'b1', city: 'Бургас' },
    });
  });
});

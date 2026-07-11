import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;

  const clientDelegate = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = {
    get tenantDb() {
      return { client: clientDelegate };
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(ClientsService);
  });

  describe('create', () => {
    it('създава клиент и изчислява age от ЕГН', async () => {
      clientDelegate.findUnique.mockResolvedValue(null);
      clientDelegate.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'client-1', ...data }),
      );

      await service.create({
        firstName: 'Иван',
        lastName: 'Петров',
        egn: '8506151239',
      });

      expect(clientDelegate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: 'Иван',
          egn: '8506151239',
          age: expect.any(Number),
        }),
      });
    });

    it('хвърля ConflictException при дублирано ЕГН', async () => {
      clientDelegate.findUnique.mockResolvedValue({
        id: 'existing',
        egn: '8506151239',
      });

      await expect(
        service.create({ firstName: 'Втори', egn: '8506151239' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(clientDelegate.create).not.toHaveBeenCalled();
    });

    it('създава lead само с име — без ЕГН', async () => {
      clientDelegate.create.mockResolvedValue({ id: 'client-2' });

      await service.create({ firstName: 'Бърз', phone: '0888123456' });

      expect(clientDelegate.findUnique).not.toHaveBeenCalled();
      expect(clientDelegate.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('филтрира deletedAt: null и пагинира', async () => {
      clientDelegate.findMany.mockResolvedValue([]);
      clientDelegate.count.mockResolvedValue(45);

      const result = await service.findAll({ page: 2, limit: 20 });

      expect(clientDelegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          skip: 20,
          take: 20,
        }),
      );
      expect(result.meta).toEqual({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
      });
    });

    it('търси по име/ЕГН/телефон', async () => {
      clientDelegate.findMany.mockResolvedValue([]);
      clientDelegate.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, search: 'Иван' });

      const where = (
        clientDelegate.findMany.mock.calls[0][0] as {
          where: { deletedAt: null; OR: unknown[] };
        }
      ).where;
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toHaveLength(4);
    });
  });

  describe('softDelete', () => {
    it('сетва deletedAt без физическо триене', async () => {
      clientDelegate.findFirst.mockResolvedValue({ id: 'client-1' });
      clientDelegate.update.mockResolvedValue({
        id: 'client-1',
        deletedAt: new Date(),
      });

      const result = await service.softDelete('client-1');

      expect(clientDelegate.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it('хвърля NotFoundException за вече изтрит клиент', async () => {
      clientDelegate.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('преизчислява age при смяна на ЕГН и пази дедупликацията', async () => {
      clientDelegate.findFirst.mockResolvedValue({
        id: 'client-1',
        egn: '8506151239',
      });
      clientDelegate.findUnique.mockResolvedValue(null);
      clientDelegate.update.mockResolvedValue({ id: 'client-1' });

      await service.update('client-1', { egn: '5209231178' });

      expect(clientDelegate.findUnique).toHaveBeenCalledWith({
        where: { egn: '5209231178' },
      });
      expect(clientDelegate.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: expect.objectContaining({
          egn: '5209231178',
          age: expect.any(Number),
        }),
      });
    });
  });
});

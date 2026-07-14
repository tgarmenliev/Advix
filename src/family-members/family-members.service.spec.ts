import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RelatedPersonRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { FamilyMembersService } from './family-members.service';

describe('FamilyMembersService', () => {
  let service: FamilyMembersService;

  const familyMemberDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const clientDelegate = {
    findFirst: jest.fn(),
  };

  const prismaMock = {
    get tenantDb() {
      return { familyMember: familyMemberDelegate, client: clientDelegate };
    },
  };

  const baseDto = {
    role: RelatedPersonRole.CO_BORROWER,
    firstName: 'Мария',
    lastName: 'Петрова',
    egn: '5209231178', // валидно ЕГН, 1952-09-23
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        FamilyMembersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(FamilyMembersService);
  });

  describe('create', () => {
    it('изчислява age от ЕГН — същата логика като Client', async () => {
      clientDelegate.findFirst.mockResolvedValue({ id: 'client-1' });
      familyMemberDelegate.findFirst.mockResolvedValue(null); // няма дубликат
      familyMemberDelegate.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'fm-1', ...data }),
      );

      await service.create('client-1', baseDto);

      expect(familyMemberDelegate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-1',
          egn: '5209231178',
          age: expect.any(Number),
          role: RelatedPersonRole.CO_BORROWER,
        }),
      });
      const created = (
        familyMemberDelegate.create.mock.calls[0][0] as {
          data: { age: number };
        }
      ).data;
      // Роден 1952 г. — възрастта е реалистична, не hardcoded 0
      expect(created.age).toBeGreaterThan(70);
    });

    it('хвърля ConflictException при същото ЕГН към същия клиент', async () => {
      clientDelegate.findFirst.mockResolvedValue({ id: 'client-1' });
      familyMemberDelegate.findFirst.mockResolvedValue({
        id: 'existing-fm',
        egn: baseDto.egn,
      });

      await expect(
        service.create('client-1', baseDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(familyMemberDelegate.create).not.toHaveBeenCalled();
    });

    it('хвърля NotFoundException при несъществуващ клиент', async () => {
      clientDelegate.findFirst.mockResolvedValue(null);

      await expect(
        service.create('missing-client', baseDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('сетва deletedAt без физическо триене', async () => {
      familyMemberDelegate.findFirst.mockResolvedValue({ id: 'fm-1' });
      familyMemberDelegate.update.mockResolvedValue({
        id: 'fm-1',
        deletedAt: new Date(),
      });

      const result = await service.softDelete('fm-1');

      expect(familyMemberDelegate.update).toHaveBeenCalledWith({
        where: { id: 'fm-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it('хвърля NotFoundException за вече изтрито лице', async () => {
      familyMemberDelegate.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('преизчислява age при смяна на ЕГН с проверка за дубликат', async () => {
      familyMemberDelegate.findFirst
        .mockResolvedValueOnce({
          id: 'fm-1',
          clientId: 'client-1',
          egn: '5209231178',
        }) // findOne
        .mockResolvedValueOnce(null); // dedup проверка
      familyMemberDelegate.update.mockResolvedValue({ id: 'fm-1' });

      await service.update('fm-1', { egn: '8506151239' });

      expect(familyMemberDelegate.update).toHaveBeenCalledWith({
        where: { id: 'fm-1' },
        data: expect.objectContaining({
          egn: '8506151239',
          age: expect.any(Number),
        }),
      });
    });
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PropertyType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PropertiesService } from './properties.service';

describe('PropertiesService', () => {
  let service: PropertiesService;

  const propertyDelegate = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const lapDelegate = {
    count: jest.fn(),
  };

  const prismaMock = {
    get tenantDb() {
      return {
        property: propertyDelegate,
        loanApplicationProperty: lapDelegate,
      };
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(PropertiesService);
  });

  it('създава имот', async () => {
    propertyDelegate.create.mockResolvedValue({ id: 'prop-1' });

    await service.create({
      propertyType: PropertyType.APARTMENT,
      city: 'София',
    });

    expect(propertyDelegate.create).toHaveBeenCalledWith({
      data: { propertyType: PropertyType.APARTMENT, city: 'София' },
    });
  });

  it('редактира съществуващ имот', async () => {
    propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
    propertyDelegate.update.mockResolvedValue({ id: 'prop-1' });

    await service.update('prop-1', { yearBuilt: 2010 });

    expect(propertyDelegate.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { yearBuilt: 2010 },
    });
  });

  it('хвърля NotFoundException при липсващ имот', async () => {
    propertyDelegate.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('delete — документирана политика: блокира при връзка', () => {
    it('трие несвързан имот', async () => {
      propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
      lapDelegate.count.mockResolvedValue(0);
      propertyDelegate.delete.mockResolvedValue({ id: 'prop-1' });

      const result = await service.delete('prop-1');

      expect(propertyDelegate.delete).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
      });
      expect(result).toEqual({ id: 'prop-1', deleted: true });
    });

    it('БЛОКИРА изтриване на имот, свързан към заявка → ConflictException', async () => {
      propertyDelegate.findUnique.mockResolvedValue({ id: 'prop-1' });
      lapDelegate.count.mockResolvedValue(2);

      await expect(service.delete('prop-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(propertyDelegate.delete).not.toHaveBeenCalled();
    });
  });
});

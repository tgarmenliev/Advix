import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { InquiryTemplatesService } from './inquiry-templates.service';
import { fillPlaceholders } from './placeholder.util';

describe('InquiryTemplatesService', () => {
  let service: InquiryTemplatesService;

  const tpl = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  };
  const db = {
    inquiryTemplate: tpl,
    $transaction: (fn: (tx: { inquiryTemplate: typeof tpl }) => Promise<unknown>) =>
      fn({ inquiryTemplate: tpl }),
  };
  const prismaMock = {
    get tenantDb() {
      return db;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InquiryTemplatesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(InquiryTemplatesService);
  });

  it('при isDefault=true маха флага от другите (точно един default)', async () => {
    tpl.create.mockResolvedValue({ id: 't1', isDefault: true });
    await service.create({
      name: 'Стандартно',
      subject: 'Запитване',
      body: 'текст',
      isDefault: true,
    });
    expect(tpl.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  });

  it('без isDefault не пипа другите шаблони', async () => {
    tpl.create.mockResolvedValue({ id: 't2' });
    await service.create({ name: 'Друг', subject: 'S', body: 'B' });
    expect(tpl.updateMany).not.toHaveBeenCalled();
  });

  it('getDefault хвърля NotFound ако няма default', async () => {
    tpl.findFirst.mockResolvedValue(null);
    await expect(service.getDefault()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('fillPlaceholders', () => {
  it('замества познатите placeholder-и', () => {
    expect(
      fillPlaceholders('Здравейте, {clientName}, сума {amount}', {
        clientName: 'Иван Петров',
        amount: '250000',
      }),
    ).toBe('Здравейте, Иван Петров, сума 250000');
  });

  it('оставя непознатите непокътнати', () => {
    expect(fillPlaceholders('{clientName} {missing}', { clientName: 'Иван' })).toBe(
      'Иван {missing}',
    );
  });
});

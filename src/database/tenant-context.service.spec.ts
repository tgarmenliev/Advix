import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { TenantContextService } from './tenant-context.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TenantContextService — tenant isolation (КРИТИЧЕН)', () => {
  let tenantContext: TenantContextService;

  beforeEach(() => {
    tenantContext = new TenantContextService();
  });

  it('изолира паралелни async операции с различен tenant контекст', async () => {
    const observed: Record<string, string> = {};

    // Изкуствено разменено забавяне форсира interleaving: операцията на A
    // приключва СЛЕД като B е стартирала и завършила в своя контекст.
    await Promise.all([
      tenantContext.run(
        { tenantId: 'A', schemaName: 'tenant_a' },
        async () => {
          await sleep(50);
          observed.a = tenantContext.getSchemaName();
          expect(tenantContext.getSchemaName()).toBe('tenant_a'); // не 'tenant_b'!
          expect(tenantContext.getTenantId()).toBe('A');
        },
      ),
      tenantContext.run(
        { tenantId: 'B', schemaName: 'tenant_b' },
        async () => {
          await sleep(10);
          observed.b = tenantContext.getSchemaName();
          expect(tenantContext.getSchemaName()).toBe('tenant_b');
          expect(tenantContext.getTenantId()).toBe('B');
        },
      ),
    ]);

    expect(observed).toEqual({ a: 'tenant_a', b: 'tenant_b' });
  });

  it('пренася контекста през многостъпков await chain', async () => {
    const deepRead = async (): Promise<string> => {
      await sleep(5);
      await Promise.resolve();
      await sleep(5);
      return tenantContext.getSchemaName();
    };

    const result = await tenantContext.run(
      { tenantId: 'X', schemaName: 'tenant_x' },
      () => deepRead(),
    );

    expect(result).toBe('tenant_x');
  });

  it('контекстът не изтича извън run()', async () => {
    await tenantContext.run(
      { tenantId: 'A', schemaName: 'tenant_a' },
      async () => {
        await sleep(5);
      },
    );

    expect(tenantContext.hasContext()).toBe(false);
  });

  it('хвърля при достъп без активен контекст', () => {
    expect(tenantContext.hasContext()).toBe(false);
    expect(() => tenantContext.getSchemaName()).toThrow(
      InternalServerErrorException,
    );
    expect(() => tenantContext.getTenantId()).toThrow(
      InternalServerErrorException,
    );
  });
});

describe('PrismaService.tenantDb — schema resolution през контекста', () => {
  let prisma: PrismaService;
  let tenantContext: TenantContextService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantContextService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(
              () => 'postgresql://test:test@localhost:5432/test',
            ),
          },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    tenantContext = moduleRef.get(TenantContextService);
  });

  it('хвърля InternalServerErrorException без tenant контекст', () => {
    expect(() => prisma.tenantDb).toThrow(InternalServerErrorException);
  });

  it('паралелни контексти получават клиенти за собствената си schema', async () => {
    const clients: Record<string, unknown> = {};

    await Promise.all([
      tenantContext.run(
        { tenantId: 'A', schemaName: 'tenant_a' },
        async () => {
          await sleep(30);
          clients.a = prisma.tenantDb;
        },
      ),
      tenantContext.run(
        { tenantId: 'B', schemaName: 'tenant_b' },
        async () => {
          await sleep(5);
          clients.b = prisma.tenantDb;
        },
      ),
    ]);

    expect(clients.a).toBeDefined();
    expect(clients.b).toBeDefined();
    // Различни schemas → различни PrismaClient инстанции
    expect(clients.a).not.toBe(clients.b);
    // Една и съща schema → кешираната инстанция
    tenantContext.run({ tenantId: 'A', schemaName: 'tenant_a' }, () => {
      expect(prisma.tenantDb).toBe(clients.a);
    });
  });

  it('отхвърля невалидно schema име', () => {
    tenantContext.run(
      { tenantId: 'evil', schemaName: 'tenant"; DROP SCHEMA public;--' },
      () => {
        expect(() => prisma.tenantDb).toThrow(InternalServerErrorException);
      },
    );
  });
});

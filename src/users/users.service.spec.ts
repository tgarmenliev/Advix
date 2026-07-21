import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const userDelegate = { findUnique: jest.fn() };
  const prismaMock = {
    get publicDb() {
      return { user: userDelegate };
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('връща града на потребителя (от public schema)', async () => {
    userDelegate.findUnique.mockResolvedValue({ city: 'София' });
    await expect(service.getCurrentUserCity('user-1')).resolves.toBe('София');
    expect(userDelegate.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { city: true },
    });
  });

  it('връща null ако градът не е попълнен', async () => {
    userDelegate.findUnique.mockResolvedValue({ city: null });
    await expect(service.getCurrentUserCity('user-1')).resolves.toBeNull();
  });

  it('връща null ако потребителят не съществува', async () => {
    userDelegate.findUnique.mockResolvedValue(null);
    await expect(service.getCurrentUserCity('missing')).resolves.toBeNull();
  });
});

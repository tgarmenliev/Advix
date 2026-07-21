import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Градът на потребителя (User живее в public schema).
   *
   * Ползва се за мекия филтър на банкови контакти в банковия модул (следваща
   * фаза): по подразбиране контактите се показват от града на консултанта, но
   * филтърът НЕ е заключващ — консултантът може да поиска друг град или всички.
   */
  async getCurrentUserCity(userId: string): Promise<string | null> {
    const user = await this.prismaService.publicDb.user.findUnique({
      where: { id: userId },
      select: { city: true },
    });
    return user?.city ?? null;
  }
}

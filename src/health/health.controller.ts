import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prismaService: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let database: 'connected' | 'error' = 'connected';
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database,
    };
  }
}

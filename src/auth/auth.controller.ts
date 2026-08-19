import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuditAction } from '@prisma/client';
import { AuditLog } from '../audit-log/decorators/audit-log.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @AuditLog({
    action: AuditAction.LOGIN,
    entityType: 'User',
    entityIdSource: 'response',
    entityIdParam: 'user.id',
    tenantIdParam: 'user.tenantId',
  })
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } }) // 5 опита / 15 мин / IP
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @AuditLog({
    action: AuditAction.REFRESH_TOKEN,
    entityType: 'User',
    entityIdSource: 'accessTokenClaims',
  })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @AuditLog({
    action: AuditAction.LOGOUT,
    entityType: 'User',
    entityIdSource: 'currentUser',
  })
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@CurrentUser('userId') userId: string) {
    await this.authService.logout(userId);
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.userId);
  }
}

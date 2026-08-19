import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogService } from './audit-log.service';
import { AuditLogsController } from './audit-logs.controller';

/**
 * Регистрира AuditLogInterceptor глобално през APP_INTERCEPTOR — никой
 * контролер/сервиз не го извиква ръчно, той просто се включва на всеки
 * маршрут, маркиран с @AuditLog(). JwtService идва от AuthModule
 * (JwtModule.register({ global: true })), не се регистрира тук повторно.
 */
@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditLogService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}

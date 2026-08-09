import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BankInquiriesModule } from './bank-inquiries/bank-inquiries.module';
import { BankOffersModule } from './bank-offers/bank-offers.module';
import { BanksModule } from './banks/banks.module';
import { ClientsModule } from './clients/clients.module';
import { CommissionSchemesModule } from './commission-schemes/commission-schemes.module';
import { CommissionsModule } from './commissions/commissions.module';
import { FamilyMembersModule } from './family-members/family-members.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import {
  PUBLIC_ROUTES,
  TenantMiddleware,
} from './common/middleware/tenant.middleware';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './database/database.module';
import { DisbursementsModule } from './disbursements/disbursements.module';
import { HealthController } from './health/health.controller';
import { InquiryTemplatesModule } from './inquiry-templates/inquiry-templates.module';
import { LoanApplicationsModule } from './loan-applications/loan-applications.module';
import { PropertiesModule } from './properties/properties.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRoot([{ ttl: 15 * 60 * 1000, limit: 5 }]),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    ClientsModule,
    FamilyMembersModule,
    LoanApplicationsModule,
    PropertiesModule,
    UsersModule,
    BanksModule,
    InquiryTemplatesModule,
    BankInquiriesModule,
    BankOffersModule,
    CommissionSchemesModule,
    DisbursementsModule,
    CommissionsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude(...PUBLIC_ROUTES)
      .forRoutes('{*splat}');
  }
}

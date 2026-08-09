import { Module } from '@nestjs/common';
import { CommissionSchemesController } from './commission-schemes.controller';
import { CommissionSchemesService } from './commission-schemes.service';

@Module({
  controllers: [CommissionSchemesController],
  providers: [CommissionSchemesService],
  exports: [CommissionSchemesService],
})
export class CommissionSchemesModule {}

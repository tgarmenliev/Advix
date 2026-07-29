import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BankContactsController } from './bank-contacts.controller';
import { BankContactsService } from './bank-contacts.service';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  imports: [UsersModule],
  controllers: [BanksController, BankContactsController],
  providers: [BanksService, BankContactsService],
  exports: [BanksService, BankContactsService],
})
export class BanksModule {}

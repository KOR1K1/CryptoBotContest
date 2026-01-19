import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceService } from './balance.service';
import { User, UserSchema } from '../../models/user.schema';
import {
  LedgerEntry,
  LedgerEntrySchema,
} from '../../models/ledger-entry.schema';

/**
 * BalanceModule
 *
 * Provides BalanceService for all balance operations
 * This module should be imported by other modules that need balance management
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    ]),
  ],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}


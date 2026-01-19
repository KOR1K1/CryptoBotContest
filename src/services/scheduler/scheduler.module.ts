import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { RoundSchedulerService } from './round-scheduler.service';
import { Auction, AuctionSchema } from '../../models/auction.schema';
import {
  AuctionRound,
  AuctionRoundSchema,
} from '../../models/auction-round.schema';
import { AuctionModule } from '../auction/auction.module';
import { GatewaysModule } from '../../gateways/gateways.module';
import { ThrottlerModule } from '../throttler/throttler.module';

/**
 * SchedulerModule
 *
 * Provides RoundSchedulerService for automatic round closing
 * Uses @nestjs/schedule for cron jobs
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable scheduling
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
      { name: AuctionRound.name, schema: AuctionRoundSchema },
    ]),
    AuctionModule, // Depends on AuctionService
    GatewaysModule, // WebSocket gateway for real-time updates
    forwardRef(() => ThrottlerModule), // WebSocket throttling (forwardRef to avoid circular dependency)
  ],
  providers: [RoundSchedulerService],
  exports: [RoundSchedulerService],
})
export class SchedulerModule {}


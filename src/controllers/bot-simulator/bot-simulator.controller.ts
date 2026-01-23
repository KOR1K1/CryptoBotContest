import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { User, UserDocument } from '../../models/user.schema';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { Bid, BidDocument } from '../../models/bid.schema';
import { BulkBotSimulationDto } from '../../dto/bulk-bot-simulation.dto';
import { BalanceService } from '../../services/balance/balance.service';
import { BidService } from '../../services/bid/bid.service';
import { Logger } from '@nestjs/common';

// симулятор ботов для нагрузочного тестирования
@ApiTags('Bot Simulator')
@Controller('bot-simulator')
export class BotSimulatorController {
  private readonly logger = new Logger(BotSimulatorController.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private balanceService: BalanceService,
    private bidService: BidService,
  ) {}

  // массовое создание ботов и ставок, все на сервере
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Run bulk bot simulation',
    description: 'Creates multiple bots and places bids server-side. Optimized for load testing without HTTP request limits. All operations are performed in batches for maximum performance.',
  })
  @ApiResponse({ status: 200, description: 'Bot simulation completed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters or no running auctions' })
  async runBulkSimulation(@Body() dto: BulkBotSimulationDto) {
    const startTime = Date.now();

    if (dto.maxBid < dto.minBid) {
      throw new BadRequestException('maxBid must be >= minBid');
    }

    const runningAuctions = await this.auctionModel
      .find({ status: 'RUNNING' })
      .exec();

    if (runningAuctions.length === 0) {
      throw new NotFoundException('No running auctions found. Please start an auction first.');
    }

    this.logger.log(
      `Starting bulk bot simulation: ${dto.numBots} bots, ${dto.bidsPerBot} bids per bot, auctions: ${runningAuctions.length}`,
    );

    let botsCreated = 0;
    let bidsPlaced = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 100; // создаем батчами для скорости
    const bots: UserDocument[] = [];

    for (let i = 0; i < dto.numBots; i += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, dto.numBots - i);
      const batch: Array<{ username: string; balance: number; lockedBalance: number }> = [];

      for (let j = 0; j < batchSize; j++) {
        const username = `bot_${Date.now()}_${i + j}`;
        batch.push({
          username,
          balance: 0,
          lockedBalance: 0,
        });
      }

      try {
        const createdBots = await this.userModel.insertMany(batch, { ordered: false });
        bots.push(...createdBots);
        botsCreated += createdBots.length;
        for (const bot of createdBots) {
          if (dto.initialBalance > 0) {
            try {
              await this.balanceService.deposit(
                bot._id.toString(),
                dto.initialBalance,
                `Initial balance for bot ${bot.username}`,
              );
            } catch (err: any) {
              this.logger.warn(`Failed to deposit balance for bot ${bot.username}: ${err?.message || String(err)}`);
              errors.push(`Balance deposit failed for bot ${bot.username}`);
            }
          }
        }
      } catch (err: any) {
        // дубликаты юзернеймов - ок, ordered: false позволяет частичный успех
        if (err.code === 11000) {
          this.logger.warn(`Some bots in batch ${i} had duplicate usernames, continuing...`);
          errors.push(`Batch ${i}: Some duplicate usernames`);
        } else {
          this.logger.error(`Error creating bot batch ${i}: ${err.message}`);
          errors.push(`Batch ${i}: ${err.message}`);
        }
      }
    }

    for (const bot of bots) {
      for (let j = 0; j < dto.bidsPerBot; j++) {
        const auction = runningAuctions[Math.floor(Math.random() * runningAuctions.length)];
        const lo = Math.max(auction.minBid || 100, dto.minBid);
        const hi = Math.max(lo, dto.maxBid);
        const bidAmount = Math.max(lo, Math.round(lo + Math.random() * (hi - lo)));

        try {
          await this.bidService.placeBid(bot._id.toString(), {
            auctionId: auction._id.toString(),
            amount: bidAmount,
            currentRound: auction.currentRound || 0,
          });
          bidsPlaced++;
        } catch (err: any) {
          // некоторые ставки могут упасть из-за конкурентности - это нормально
          const errorMsg = err.message || String(err);
          if (!errors.includes(errorMsg)) {
            errors.push(errorMsg);
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    this.logger.log(
      `Bulk bot simulation completed: ${botsCreated} bots created, ${bidsPlaced} bids placed in ${duration}ms`,
    );

    return {
      success: true,
      botsCreated,
      bidsPlaced,
      duration,
      errors: errors.slice(0, 10), // первые 10 ошибок чтобы ответ не раздулся
      message: `Created ${botsCreated} bots and placed ${bidsPlaced} bids in ${duration}ms`,
    };
  }
}

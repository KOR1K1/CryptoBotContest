import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { CreateAuctionDto } from '../../dto/create-auction.dto';
import { PlaceBidDto } from '../../dto/place-bid.dto';
import { PlaceBidBotDto } from '../../dto/place-bid-bot.dto';
import { AuctionService } from '../../services/auction/auction.service';
import { BidService } from '../../services/bid/bid.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Gift, GiftDocument } from '../../models/gift.schema';
import { Bid, BidDocument } from '../../models/bid.schema';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { ParseMongoIdPipe } from '../../common/pipes/mongo-id.pipe';
import { AuctionsGateway } from '../../gateways/auctions.gateway';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../models/user.schema';

// Контроллер для работы с аукционами
@ApiTags('Auctions')
@Controller('auctions')
export class AuctionsController {
  private readonly logger = new Logger(AuctionsController.name);

  constructor(
    private auctionService: AuctionService,
    private bidService: BidService,
    @InjectModel(Gift.name) private giftModel: Model<GiftDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private auctionsGateway: AuctionsGateway,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {}

  @Get()
  @SkipThrottle() // гет-запросы не лимитим
  @ApiOperation({ summary: 'Get all auctions', description: 'Returns a list of all auctions with their current status' })
  @ApiResponse({ status: 200, description: 'List of auctions retrieved successfully' })
  async getAllAuctions() {
    const auctions = await this.auctionService.getAllAuctions();

    return auctions.map((auction) => ({
      id: auction._id,
      giftId: auction.giftId,
      status: auction.status,
      totalGifts: auction.totalGifts,
      totalRounds: auction.totalRounds,
      currentRound: auction.currentRound,
      roundDurationMs: auction.roundDurationMs,
      minBid: auction.minBid,
      startedAt: auction.startedAt,
      endsAt: auction.endsAt,
      createdAt: auction.createdAt,
      createdBy: auction.createdBy?.toString(),
    }));
  }

  // создание нового аукциона
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new auction', description: 'Creates a new auction for the specified gift. Requires authentication.' })
  @ApiResponse({ status: 201, description: 'Auction created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Gift not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createAuction(
    @Body() dto: CreateAuctionDto,
    @CurrentUser() user: UserDocument,
  ) {
    const gift = await this.giftModel.findById(dto.giftId).exec();
    if (!gift) {
      throw new NotFoundException('Gift not found');
    }

    const auction = await this.auctionService.createAuction({
      giftId: dto.giftId,
      totalGifts: dto.totalGifts,
      totalRounds: dto.totalRounds,
      roundDurationMs: dto.roundDurationMs,
      minBid: dto.minBid,
      createdBy: user._id.toString(),
    });

    this.auctionsGateway.emitAuctionsListUpdate();

    return {
      id: auction._id,
      giftId: auction.giftId,
      status: auction.status,
      totalGifts: auction.totalGifts,
      totalRounds: auction.totalRounds,
      currentRound: auction.currentRound,
      roundDurationMs: auction.roundDurationMs,
      minBid: auction.minBid,
      createdAt: auction.createdAt,
    };
  }

  // запуск аукциона
  @Post(':id/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an auction', description: 'Starts the auction, creating the first round and transitioning status to RUNNING. Requires authentication.' })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Auction started successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  @ApiResponse({ status: 400, description: 'Auction cannot be started (wrong status)' })
  async startAuction(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: UserDocument,
  ) {
    const auction = await this.auctionService.startAuction(id, user._id.toString());
    
    this.auctionsGateway.emitAuctionUpdate(id, auction);
    this.auctionsGateway.emitAuctionsListUpdate();

    const currentRound = await this.auctionService.getCurrentRound(id);

    return {
      id: auction._id,
      status: auction.status,
      currentRound: auction.currentRound,
      startedAt: auction.startedAt,
      round: currentRound
        ? {
            roundIndex: currentRound.roundIndex,
            startedAt: currentRound.startedAt,
            endsAt: currentRound.endsAt,
            closed: currentRound.closed,
          }
        : null,
    };
  }

  // эндпоинт для ботов, без лимитов
  // должен быть выше /auctions/:id/bids иначе роутинг сломается
  @Post(':id/bids/bot')
  @HttpCode(HttpStatus.CREATED)
  @SkipThrottle()
  @ApiOperation({ 
    summary: 'Place a bid (bot simulation)', 
    description: 'Places or updates a bid in the auction. Special endpoint without rate limits for bot simulation and testing. userId is accepted in request body (no JWT required). If user already has an active bid, amount must be higher than current bid.' 
  })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid bid (insufficient balance, bid too low, etc.)' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async placeBidBot(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: PlaceBidBotDto,
  ) {
    const auction = await this.auctionService.getAuctionById(id);
    const currentRoundData = await this.auctionService.getCurrentRound(id);

    if (!currentRoundData) {
      throw new BadRequestException('Auction has no active round');
    }

    // у ботов userId в теле запроса
    const bid = await this.bidService.placeBid(
      dto.userId,
      {
        auctionId: id,
        amount: dto.amount,
        currentRound: auction.currentRound,
      },
    );

    const bidResponse = {
      id: bid._id,
      userId: bid.userId,
      auctionId: bid.auctionId,
      amount: bid.amount,
      status: bid.status,
      roundIndex: bid.roundIndex,
      createdAt: bid.createdAt,
    };

    await this.invalidateDashboardCache(id);

    this.auctionsGateway.emitBidUpdate(id, bidResponse);
    this.auctionsGateway.emitAuctionsListUpdate();

    return bidResponse;
  }

  // ставка от пользователя, лимит 5/сек и 20/10сек
  @Post(':id/bids')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 10000, limit: 20 } })
  @ApiOperation({ 
    summary: 'Place a bid', 
    description: 'Places or updates a bid in the auction. If user already has an active bid, amount must be higher than current bid.' 
  })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiResponse({ status: 201, description: 'Bid placed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid bid (insufficient balance, bid too low, etc.)' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async placeBid(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: PlaceBidDto,
    @CurrentUser() user: UserDocument,
  ) {
    const auction = await this.auctionService.getAuctionById(id);
    const currentRoundData = await this.auctionService.getCurrentRound(id);

    if (!currentRoundData) {
      throw new BadRequestException('Auction has no active round');
    }

    const bid = await this.bidService.placeBid(
      user._id.toString(),
      {
      auctionId: id,
      amount: dto.amount,
      currentRound: auction.currentRound,
      },
    );

    const bidResponse = {
      id: bid._id,
      userId: bid.userId,
      auctionId: bid.auctionId,
      amount: bid.amount,
      status: bid.status,
      roundIndex: bid.roundIndex,
      createdAt: bid.createdAt,
    };

    await this.invalidateDashboardCache(id);

    this.auctionsGateway.emitBidUpdate(id, bidResponse);
    this.auctionsGateway.emitAuctionsListUpdate();

    return bidResponse;
  }

  // сбрасываем кеш дашборда когда ставка обновилась
  private async invalidateDashboardCache(auctionId: string): Promise<void> {
    try {
      await this.cacheManager.del(`dashboard:${auctionId}:all`);
      // юзер-специфичные ключи просто протухнут по TTL, это норм
    } catch (error) {
      // если кеш не сбросился - не критично, протухнет сам
      this.logger.error(
        `Error invalidating dashboard cache for auction ${auctionId}:`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // все раунды аукциона с победителями
  @Get(':id/rounds')
  @SkipThrottle()
  async getAuctionRounds(@Param('id', ParseMongoIdPipe) id: string) {
    const rounds = await this.auctionService.getAuctionRounds(id);

    const roundsWithWinners = await Promise.all(
      rounds.map(async (r) => {
        let winners: any[] = [];
        if (r.closed) {
          // ищем выигравшие ставки, сначала по wonInRoundIndex (если перенеслась из прошлого раунда)
          // иначе по roundIndex (старые записи где ставка и выигрыш в одном раунде)
          const wonBids = await this.bidModel
            .find({
              auctionId: id,
              status: BidStatus.WON,
              $or: [
                { wonInRoundIndex: r.roundIndex },
                { wonInRoundIndex: { $exists: false }, roundIndex: r.roundIndex },
              ],
            })
            .sort({ amount: -1, createdAt: 1 })
            .exec();

          const { User, UserSchema } = await import('../../models/user.schema');
          const userModel = this.giftModel.db.model('User', UserSchema);

          winners = await Promise.all(
            wonBids.map(async (bid) => {
              const user = await userModel.findById(bid.userId).exec();
              return {
                userId: bid.userId,
                username: user?.username || 'Unknown',
                bidAmount: bid.amount,
                wonAt: bid.updatedAt || bid.createdAt,
                placedInRound: bid.roundIndex, // в каком раунде была сделана ставка (для "из раунда X")
              };
            }),
          );
        }

        return {
          id: r._id,
          auctionId: r.auctionId,
          roundIndex: r.roundIndex,
          startedAt: r.startedAt,
          endsAt: r.endsAt,
          closed: r.closed,
          winnersCount: r.winnersCount,
          winners: winners,
          createdAt: r.createdAt,
        };
      }),
    );

    return roundsWithWinners;
  }

  // все ставки по аукциону
  @Get(':id/bids')
  @SkipThrottle()
  async getAuctionBids(@Param('id', ParseMongoIdPipe) id: string) {
    const allBids = await this.bidModel
      .find({ auctionId: id })
      .sort({ amount: -1, createdAt: 1 })
      .exec();

    return allBids.map((b: BidDocument) => ({
      id: b._id,
      userId: b.userId,
      auctionId: b.auctionId,
      amount: b.amount,
      status: b.status,
      roundIndex: b.roundIndex,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
  }

  // данные для дашборда фронтенда
  // кешируется в редисе на 1-5 сек, сбрасывается при обновлении ставок
  @Get(':id/dashboard')
  @SkipThrottle()
  async getAuctionDashboard(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('userId') userId?: string,
  ) {
    const cacheKey = `dashboard:${id}:${userId || 'all'}`;
    const defaultCacheTtl = this.configService.get<number>('cache.ttl.dashboard', 1000);

    const cached = await this.cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }
    const auction = await this.auctionService.getAuctionById(id);
    const currentRound = await this.auctionService.getCurrentRound(id);

    let giftsInfo;
    try {
      giftsInfo = await this.auctionService.calculateGiftsPerRoundForDisplay(id);
    } catch (error) {
      // если аукцион еще не начался - дефолтные значения
      giftsInfo = {
        giftsPerRound: Math.ceil(auction.totalGifts / auction.totalRounds),
        remainingGifts: auction.totalGifts,
        alreadyAwarded: 0,
      };
    }

    const topBids = await this.bidService.getTopActiveBids(id, 3);
    const { User, UserSchema } = await import('../../models/user.schema');
    const userModel = this.giftModel.db.model('User', UserSchema);

    const topBidsWithUsers = await Promise.all(
      topBids.map(async (bid, index) => {
        const user = await userModel.findById(bid.userId).exec();
        return {
          position: index + 1,
          userId: bid.userId.toString(),
          username: user?.username || 'Unknown',
          amount: bid.amount,
          createdAt: bid.createdAt,
          roundIndex: bid.roundIndex,
        };
      }),
    );

    let userPosition: {
      position: number | null;
      amount: number | null;
      isOutbid: boolean;
      canWin: boolean;
    } = {
      position: null,
      amount: null,
      isOutbid: false,
      canWin: false,
    };

    if (userId && currentRound) {
      const userPositionData = await this.bidService.getUserPosition(id, userId);
      if (userPositionData.position !== null) {
        userPosition = {
          position: userPositionData.position,
          amount: userPositionData.amount,
          isOutbid: userPositionData.position > giftsInfo.giftsPerRound,
          canWin: userPositionData.position <= giftsInfo.giftsPerRound,
        };
      }
    }

    const now = new Date();
    let timeUntilRoundEnd = 0;
    let totalTimeRemaining = 0;

    if (currentRound) {
      timeUntilRoundEnd = Math.max(0, currentRound.endsAt.getTime() - now.getTime());
      const roundsRemaining = auction.totalRounds - auction.currentRound - 1;
      totalTimeRemaining = timeUntilRoundEnd + roundsRemaining * auction.roundDurationMs;
    }

    const dashboardData = {
      auction: {
        id: auction._id.toString(),
        giftId: auction.giftId.toString(),
        status: auction.status,
        totalGifts: auction.totalGifts,
        totalRounds: auction.totalRounds,
        currentRound: auction.currentRound,
        minBid: auction.minBid,
        createdBy: auction.createdBy?.toString(),
      },
      currentRound: currentRound
        ? {
            roundIndex: currentRound.roundIndex,
            startedAt: currentRound.startedAt,
            endsAt: currentRound.endsAt,
            timeUntilEndMs: timeUntilRoundEnd,
            totalTimeRemainingMs: totalTimeRemaining,
          }
        : null,
      gifts: {
        totalGifts: auction.totalGifts,
        alreadyAwarded: giftsInfo.alreadyAwarded,
        remainingGifts: giftsInfo.remainingGifts,
        giftsPerRound: giftsInfo.giftsPerRound,
      },
      topBids: topBidsWithUsers,
      userPosition,
    };

    const isRunning = dashboardData.auction?.status === 'RUNNING';
    const isCompleted = dashboardData.auction?.status === 'COMPLETED';
    const isRunningNoBids = isRunning && (!topBidsWithUsers || topBidsWithUsers.length === 0);

    // для активных аукционов кеш короче, для завершенных - длиннее
    let cacheTtl = defaultCacheTtl;
    if (isCompleted) {
      cacheTtl = 5000;
    } else if (isRunning) {
      cacheTtl = 300;
      if (isRunningNoBids) {
        cacheTtl = 200; // если ставок еще нет - еще короче
      }
    }
    await this.cacheManager.set(cacheKey, dashboardData, cacheTtl);

    return dashboardData;
  }

  // получение аукциона по id
  // должен быть в конце, после всех специфичных роутов
  @Get(':id')
  @SkipThrottle()
  @ApiOperation({ summary: 'Get auction by ID', description: 'Returns auction details including all rounds' })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Auction retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async getAuction(@Param('id', ParseMongoIdPipe) id: string) {
    const auction = await this.auctionService.getAuctionById(id);
    const currentRound = await this.auctionService.getCurrentRound(id);
    const allRounds = await this.auctionService.getAuctionRounds(id);

    return {
      id: auction._id,
      giftId: auction.giftId,
      status: auction.status,
      totalGifts: auction.totalGifts,
      totalRounds: auction.totalRounds,
      currentRound: auction.currentRound,
      roundDurationMs: auction.roundDurationMs,
      minBid: auction.minBid,
      startedAt: auction.startedAt,
      endsAt: auction.endsAt,
      createdAt: auction.createdAt,
      createdBy: auction.createdBy?.toString(),
      currentRoundData: currentRound
        ? {
            roundIndex: currentRound.roundIndex,
            startedAt: currentRound.startedAt,
            endsAt: currentRound.endsAt,
            closed: currentRound.closed,
            winnersCount: currentRound.winnersCount,
          }
        : null,
      rounds: allRounds.map((r) => ({
        roundIndex: r.roundIndex,
        startedAt: r.startedAt,
        endsAt: r.endsAt,
        closed: r.closed,
        winnersCount: r.winnersCount,
      })),
    };
  }
}



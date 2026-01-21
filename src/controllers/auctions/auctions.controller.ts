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
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CreateAuctionDto } from '../../dto/create-auction.dto';
import { PlaceBidDto } from '../../dto/place-bid.dto';
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

/**
 * AuctionsController
 *
 * Handles auction-related API endpoints
 */
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

  /**
   * GET /auctions
   * Get all auctions
   *
   * @returns Array of auctions
   */
  @Get()
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
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
    }));
  }

  /**
   * POST /auctions
   * Create a new auction
   *
   * @param dto CreateAuctionDto
   * @returns Created auction
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new auction', description: 'Creates a new auction for the specified gift' })
  @ApiResponse({ status: 201, description: 'Auction created successfully' })
  @ApiResponse({ status: 404, description: 'Gift not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createAuction(@Body() dto: CreateAuctionDto) {
    // Verify gift exists
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
    });

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

  /**
   * POST /auctions/:id/start
   * Start an auction (create first round, transition to RUNNING)
   *
   * @param id Auction ID
   * @returns Started auction
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an auction', description: 'Starts the auction, creating the first round and transitioning status to RUNNING' })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Auction started successfully' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  @ApiResponse({ status: 400, description: 'Auction cannot be started (wrong status)' })
  async startAuction(@Param('id', ParseMongoIdPipe) id: string) {
    const auction = await this.auctionService.startAuction(id);
    
    // Emit WebSocket update
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

  /**
   * POST /auctions/:id/bids/bot
   * Place a bid in an auction (for bot simulation)
   * Special endpoint WITHOUT rate limits for testing and simulation purposes
   * NOTE: Must be before /auctions/:id/bids to avoid route conflicts
   *
   * No rate limiting: This endpoint is specifically for bot simulation and testing.
   * Allows unlimited bids for testing purposes (load testing, stress testing, etc.)
   *
   * @param id Auction ID
   * @param dto PlaceBidDto
   * @returns Created/updated bid
   */
  @Post(':id/bids/bot')
  @HttpCode(HttpStatus.CREATED)
  @SkipThrottle() // Skip rate limiting for bot simulation endpoint
  @ApiOperation({ 
    summary: 'Place a bid (bot simulation)', 
    description: 'Places or updates a bid in the auction. Special endpoint without rate limits for bot simulation and testing. If user already has an active bid, amount must be higher than current bid.' 
  })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid bid (insufficient balance, bid too low, etc.)' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  async placeBidBot(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: PlaceBidDto,
  ) {
    // Reuse the same logic as placeBid
    return this.placeBid(id, dto);
  }

  /**
   * POST /auctions/:id/bids
   * Place a bid in an auction
   * NOTE: Must be before GET routes to avoid conflicts
   *
   * Rate limited: 5 bids per second, 20 per 10 seconds (stricter than default)
   * This prevents bid spamming while allowing legitimate rapid bidding
   *
   * @param id Auction ID
   * @param dto PlaceBidDto
   * @returns Created/updated bid
   */
  @Post(':id/bids')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 10000, limit: 20 } }) // Stricter limits for bids
  @ApiOperation({ 
    summary: 'Place a bid', 
    description: 'Places or updates a bid in the auction. If user already has an active bid, amount must be higher than current bid.' 
  })
  @ApiParam({ name: 'id', description: 'Auction ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 201, description: 'Bid placed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid bid (insufficient balance, bid too low, etc.)' })
  @ApiResponse({ status: 404, description: 'Auction not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async placeBid(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() dto: PlaceBidDto,
  ) {
    // Get current round from auction
    const auction = await this.auctionService.getAuctionById(id);
    const currentRoundData = await this.auctionService.getCurrentRound(id);

    if (!currentRoundData) {
      throw new BadRequestException('Auction has no active round');
    }

    const bid = await this.bidService.placeBid({
      userId: dto.userId,
      auctionId: id,
      amount: dto.amount,
      currentRound: auction.currentRound,
    });

    const bidResponse = {
      id: bid._id,
      userId: bid.userId,
      auctionId: bid.auctionId,
      amount: bid.amount,
      status: bid.status,
      roundIndex: bid.roundIndex,
      createdAt: bid.createdAt,
    };

    // Invalidate cache for this auction (bid update changes dashboard data)
    await this.invalidateDashboardCache(id);

    // Emit WebSocket update
    this.auctionsGateway.emitBidUpdate(id, bidResponse);
    this.auctionsGateway.emitAuctionsListUpdate();

    return bidResponse;
  }

  /**
   * Invalidate dashboard cache for an auction
   * Called when bid updates occur
   * 
   * @param auctionId Auction ID
   */
  private async invalidateDashboardCache(auctionId: string): Promise<void> {
    try {
      // Invalidate dashboard cache for this auction
      // Pattern: dashboard:${auctionId}:*
      // Delete common cache key (dashboard:auctionId:all)
      await this.cacheManager.del(`dashboard:${auctionId}:all`);
      
      // Note: For user-specific cache keys, we rely on TTL expiration
      // (cache expires in 1-5 seconds anyway, so stale data is acceptable for a short period)
      // For production, could implement pattern-based deletion using Redis directly
    } catch (error) {
      // Log error but don't fail the request (cache invalidation is not critical)
      this.logger.error(
        `Error invalidating dashboard cache for auction ${auctionId}:`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * GET /auctions/:id/rounds
   * Get all rounds for an auction with winner information
   * NOTE: Must be before /auctions/:id route to avoid route conflicts
   *
   * @param id Auction ID
   * @returns Array of rounds with winners
   */
  @Get(':id/rounds')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  async getAuctionRounds(@Param('id', ParseMongoIdPipe) id: string) {
    const rounds = await this.auctionService.getAuctionRounds(id);

    // Get winners for each closed round
    const roundsWithWinners = await Promise.all(
      rounds.map(async (r) => {
        let winners: any[] = [];
        if (r.closed) {
          // Get WON bids for this round. Use wonInRoundIndex when set (carry-over winners);
          // fallback to roundIndex for older records (bid placed and won in same round).
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
                placedInRound: bid.roundIndex, // round when bid was placed (for "from Round X" when carry-over)
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

  /**
   * GET /auctions/:id/bids
   * Get all bids for an auction (all statuses)
   * NOTE: Must be before /auctions/:id route to avoid route conflicts
   *
   * @param id Auction ID
   * @returns Array of bids
   */
  @Get(':id/bids')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  async getAuctionBids(@Param('id', ParseMongoIdPipe) id: string) {
    // Get all bids, not just active ones
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

  /**
   * GET /auctions/:id/dashboard
   * Get auction dashboard data for frontend display
   * Includes: top-3 bids, user position, gifts info, timing
   * NOTE: Must be before /auctions/:id route to avoid conflicts
   * 
   * CACHED: Results are cached in Redis for 1-5 seconds (configurable)
   * Cache key: `dashboard:${auctionId}:${userId || 'all'}`
   * Cache is invalidated on bid updates and round closures
   *
   * @param id Auction ID
   * @param userId Optional user ID to get user's position
   * @returns Dashboard data
   */
  @Get(':id/dashboard')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe, cached)
  async getAuctionDashboard(
    @Param('id', ParseMongoIdPipe) id: string,
    @Query('userId') userId?: string,
  ) {
    // Generate cache key (include userId to differentiate cache for different users)
    const cacheKey = `dashboard:${id}:${userId || 'all'}`;
    const defaultCacheTtl = this.configService.get<number>('cache.ttl.dashboard', 1000); // Base TTL (used for non-running auctions)

    // Try to get from cache first
    const cached = await this.cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from database
    const auction = await this.auctionService.getAuctionById(id);
    const currentRound = await this.auctionService.getCurrentRound(id);

    // Calculate gifts info (works even without active round)
    let giftsInfo;
    try {
      giftsInfo = await this.auctionService.calculateGiftsPerRoundForDisplay(id);
    } catch (error) {
      // If auction not started yet, use default values
      giftsInfo = {
        giftsPerRound: Math.ceil(auction.totalGifts / auction.totalRounds),
        remainingGifts: auction.totalGifts,
        alreadyAwarded: 0,
      };
    }

    // Get top-3 active bids with user info (OPTIMIZED: uses limit(3) in query)
    const topBids = await this.bidService.getTopActiveBids(id, 3);

    // Get user info for top bids
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
          roundIndex: bid.roundIndex, // Добавляем roundIndex для отображения
        };
      }),
    );

    // Calculate user position if userId provided (OPTIMIZED: uses aggregation/count)
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

    // Calculate timing (only if round exists)
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

    // Shorter TTL when RUNNING and no bids yet — bids may be arriving (e.g. bot load test)
    const isRunning = dashboardData.auction?.status === 'RUNNING';
    const isRunningNoBids = isRunning && (!topBidsWithUsers || topBidsWithUsers.length === 0);

    // More reactive cache for RUNNING auctions: shorter TTL
    let cacheTtl = defaultCacheTtl;
    if (isRunning) {
      cacheTtl = 300; // 0.3s for running auctions
      if (isRunningNoBids) {
        cacheTtl = 200; // even shorter when no bids yet
      }
    }

    // Save to cache (TTL in milliseconds)
    await this.cacheManager.set(cacheKey, dashboardData, cacheTtl);

    return dashboardData;
  }

  /**
   * GET /auctions/:id
   * Get auction by ID
   * NOTE: Must be after specific routes like /auctions/:id/rounds
   *
   * @param id Auction ID
   * @returns Auction data
   */
  @Get(':id')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
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



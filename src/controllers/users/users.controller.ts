import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { User, UserDocument } from '../../models/user.schema';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { Gift, GiftDocument } from '../../models/gift.schema';
import { CreateUserDto } from '../../dto/create-user.dto';
import { BalanceService } from '../../services/balance/balance.service';
import { BidService } from '../../services/bid/bid.service';
import { Bid, BidDocument } from '../../models/bid.schema';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { ParseMongoIdPipe } from '../../common/pipes/mongo-id.pipe';

/**
 * UsersController
 *
 * Handles user-related API endpoints
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Gift.name) private giftModel: Model<GiftDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private balanceService: BalanceService,
    private bidService: BidService,
  ) {}

  /**
   * GET /users
   * Get all users
   *
   * @returns Array of users
   */
  @Get()
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get all users', description: 'Returns a list of all registered users with their balances' })
  @ApiResponse({ status: 200, description: 'List of users retrieved successfully' })
  async getUsers() {
    const users = await this.userModel
      .find()
      .sort({ createdAt: -1 })
      .exec();

    return users.map((user) => ({
      id: user._id,
      username: user.username,
      balance: user.balance,
      lockedBalance: user.lockedBalance,
      createdAt: user.createdAt,
    }));
  }

  /**
   * POST /users
   * Create a new user
   *
   * @param dto CreateUserDto
   * @returns Created user (without sensitive data)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user', description: 'Creates a new user with optional initial balance' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async createUser(@Body() dto: CreateUserDto) {
    // Check if username already exists
    const existingUser = await this.userModel
      .findOne({ username: dto.username })
      .exec();

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const user = await this.userModel.create({
      username: dto.username,
      balance: 0,
      lockedBalance: 0,
    });

    // If initial balance is provided, deposit it
    if (dto.initialBalance && dto.initialBalance > 0) {
      await this.balanceService.deposit(
        user._id.toString(),
        dto.initialBalance,
        `Initial balance deposit for user ${dto.username}`,
      );
      // Reload user to get updated balance
      const updatedUser = await this.userModel.findById(user._id).exec();
      if (updatedUser) {
        return {
          id: updatedUser._id,
          username: updatedUser.username,
          balance: updatedUser.balance,
          lockedBalance: updatedUser.lockedBalance,
          createdAt: updatedUser.createdAt,
        };
      }
    }

    return {
      id: user._id,
      username: user.username,
      balance: user.balance,
      lockedBalance: user.lockedBalance,
      createdAt: user.createdAt,
    };
  }

  /**
   * GET /users/:id/balance
   * Get user balance information
   * NOTE: Must be before /users/:id route to avoid route conflicts
   *
   * @param id User ID
   * @returns User balance data
   */
  @Get(':id/balance')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get user balance', description: 'Returns user balance, locked balance, and validates invariants' })
  @ApiParam({ name: 'id', description: 'User ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserBalance(@Param('id', ParseMongoIdPipe) id: string) {
    const user = await this.userModel.findById(id).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate balance invariants
    const invariantsValid =
      await this.balanceService.validateBalanceInvariants(id);

    return {
      userId: user._id,
      balance: user.balance,
      lockedBalance: user.lockedBalance,
      total: user.balance + user.lockedBalance,
      invariantsValid,
    };
  }

  /**
   * GET /users/:id/bids
   * Get all bids for a user (across all auctions)
   * NOTE: Must be before /users/:id route to avoid route conflicts
   *
   * @param id User ID
   * @returns Array of user's bids
   */
  @Get(':id/bids')
  @ApiOperation({ summary: 'Get user bids', description: 'Returns all bids placed by the user across all auctions' })
  @ApiParam({ name: 'id', description: 'User ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Bids retrieved successfully' })
  async getUserBids(@Param('id', ParseMongoIdPipe) id: string) {
    const bids = await this.bidService.getUserBids(id);

    return bids.map((b: BidDocument) => ({
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
   * POST /users/:id/inventory/add
   * Add a gift to user's inventory (admin function - for testing/demo purposes)
   * Creates a fake WON bid to simulate winning a gift
   * NOTE: Must be before /users/:id/inventory route to avoid route conflicts
   *
   * @param id User ID
   * @param body { giftId: string, bidAmount: number }
   * @returns Added inventory item
   */
  @Post(':id/inventory/add')
  @HttpCode(HttpStatus.CREATED)
  async addGiftToInventory(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() body: { giftId: string; bidAmount?: number },
  ) {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const gift = await this.giftModel.findById(body.giftId).exec();
    if (!gift) {
      throw new NotFoundException('Gift not found');
    }

    // Create a fake auction for this gift (or find existing)
    let auction = await this.auctionModel.findOne({ giftId: body.giftId }).exec();
    if (!auction) {
      // Create a dummy auction
      auction = await this.auctionModel.create({
        giftId: body.giftId,
        totalGifts: 1,
        totalRounds: 1,
        roundDurationMs: 60000,
        minBid: body.bidAmount || 100,
        status: 'COMPLETED',
        currentRound: 0,
      });
    }

    // Create a WON bid for this user (wonInRoundIndex so it appears in /auctions/:id/rounds)
    const bid = await this.bidModel.create({
      userId: id,
      auctionId: auction._id,
      roundIndex: 0,
      wonInRoundIndex: 0,
      amount: body.bidAmount || 100,
      status: BidStatus.WON,
    });

    return {
      bidId: bid._id,
      auctionId: bid.auctionId,
      giftId: gift._id,
      giftTitle: gift.title,
      giftDescription: gift.description,
      giftImageUrl: gift.imageUrl,
      bidAmount: bid.amount,
      roundIndex: bid.roundIndex,
      wonAt: bid.updatedAt,
    };
  }

  /**
   * GET /users/:id/inventory
   * Get user's won gifts (inventory)
   * NOTE: Must be before /users/:id route to avoid route conflicts
   *
   * @param id User ID
   * @returns Array of won gifts with gift details
   */
  @Get(':id/inventory')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get user inventory', description: 'Returns all gifts won by the user in auctions' })
  @ApiParam({ name: 'id', description: 'User ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Inventory retrieved successfully' })
  async getUserInventory(@Param('id', ParseMongoIdPipe) id: string) {
    const { Auction, Gift } = await import('../../models');
    const auctionModel = this.userModel.db.model('Auction');
    const giftModel = this.userModel.db.model('Gift');

    // Get all WON bids for this user
    const wonBids = await this.bidService.getUserBids(id, BidStatus.WON);

    // Get gift details for each bid
    const inventory = await Promise.all(
      wonBids.map(async (bid: BidDocument) => {
        const auction = await auctionModel.findById(bid.auctionId).exec();
        if (!auction) {
          return null;
        }

        const gift = await giftModel.findById(auction.giftId).exec();
        if (!gift) {
          return null;
        }

        return {
          bidId: bid._id,
          auctionId: bid.auctionId,
          giftId: gift._id,
          giftTitle: gift.title,
          giftDescription: gift.description,
          giftImageUrl: gift.imageUrl,
          bidAmount: bid.amount,
          roundIndex: bid.roundIndex,
          wonAt: bid.updatedAt,
        };
      }),
    );

    return inventory.filter((item) => item !== null);
  }

  /**
   * GET /users/:id
   * Get user by ID
   * NOTE: Must be after specific routes like /users/:id/balance
   *
   * @param id User ID
   * @returns User data
   */
  @Get(':id')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get user by ID', description: 'Returns user details including balance information' })
  @ApiParam({ name: 'id', description: 'User ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(@Param('id', ParseMongoIdPipe) id: string) {
    const user = await this.userModel.findById(id).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user._id,
      username: user.username,
      balance: user.balance,
      lockedBalance: user.lockedBalance,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}


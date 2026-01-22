import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AuctionService } from '../services/auction/auction.service';
import { BidService } from '../services/bid/bid.service';
import { BalanceService } from '../services/balance/balance.service';
import { AuctionModule } from '../services/auction/auction.module';
import { BidModule } from '../services/bid/bid.module';
import { BalanceModule } from '../services/balance/balance.module';
import { ModelsModule } from '../models/models.module';
import { User, UserDocument } from '../models/user.schema';
import { Gift, GiftDocument } from '../models/gift.schema';
import { Auction, AuctionDocument } from '../models/auction.schema';
import { Bid, BidDocument } from '../models/bid.schema';
import { LedgerEntry, LedgerEntryDocument } from '../models/ledger-entry.schema';
import { AuctionStatus } from '../common/enums/auction-status.enum';
import { BidStatus } from '../common/enums/bid-status.enum';
import { LedgerType } from '../common/enums/ledger-type.enum';
import { BadRequestException } from '@nestjs/common';

/**
 * Integration Test: Concurrent Bid Scenarios
 *
 * Tests concurrent bid placement scenarios:
 * 1. Multiple users placing bids simultaneously
 * 2. Same user placing multiple bids (should update existing bid)
 * 3. Balance consistency under concurrent load
 * 4. No duplicate active bids
 * 5. Balance invariants maintained
 */
describe('Concurrent Bids Integration Test', () => {
  let module: TestingModule;
  let mongoServer: MongoMemoryReplSet;
  let connection: Connection;
  let auctionService: AuctionService;
  let bidService: BidService;
  let balanceService: BalanceService;

  let userModel: Model<UserDocument>;
  let giftModel: Model<GiftDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let ledgerEntryModel: Model<LedgerEntryDocument>;

  let users: UserDocument[] = [];
  let gift: GiftDocument;
  let auction: AuctionDocument;

  const NUM_USERS = 10;
  const INITIAL_BALANCE = 10000;
  const BID_AMOUNT = 1000;

  beforeAll(async () => {
    // Start in-memory MongoDB with replica set (required for transactions)
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const mongoUri = mongoServer.getUri();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.test', '.env'],
        }),
        MongooseModule.forRoot(mongoUri, {
          retryWrites: true,
          retryReads: true,
        }),
        ModelsModule,
        BalanceModule,
        BidModule,
        AuctionModule,
      ],
    }).compile();

    connection = module.get<Connection>(getConnectionToken());
    auctionService = module.get<AuctionService>(AuctionService);
    bidService = module.get<BidService>(BidService);
    balanceService = module.get<BalanceService>(BalanceService);

    userModel = module.get<Model<UserDocument>>(getModelToken(User.name));
    giftModel = module.get<Model<GiftDocument>>(getModelToken(Gift.name));
    auctionModel = module.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = module.get<Model<BidDocument>>(getModelToken(Bid.name));
    ledgerEntryModel = module.get<Model<LedgerEntryDocument>>(
      getModelToken(LedgerEntry.name),
    );
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
    if (module) {
      await module.close();
    }
  });

  beforeEach(async () => {
    // Clean all collections
    await userModel.deleteMany({});
    await giftModel.deleteMany({});
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await ledgerEntryModel.deleteMany({});

    // Create test users
    users = [];
    for (let i = 0; i < NUM_USERS; i++) {
      const user = await userModel.create({
        username: `user${i}`,
        balance: INITIAL_BALANCE,
        lockedBalance: 0,
      });
      users.push(user);
    }

    // Create test gift
    gift = await giftModel.create({
      title: 'Concurrent Test Gift',
      description: 'A gift for concurrent bid testing',
      imageUrl: 'https://example.com/gift.jpg',
      basePrice: 100,
      totalSupply: 5,
      metadata: {
        rarity: 'common',
        category: 'test',
      },
    });

    // Create and start auction (use first user as creator)
    auction = await auctionService.createAuction({
      giftId: gift._id.toString(),
      totalGifts: 5,
      totalRounds: 1,
      roundDurationMs: 60000, // 60 seconds
      minBid: 100,
      createdBy: users[0]._id.toString(),
    });

    await auctionService.startAuction(auction._id.toString(), users[0]._id.toString());
  });

  it('should handle concurrent bids from multiple users', async () => {
    const currentRound = 0;
    const concurrentBids = users.map((user, index) =>
      bidService.placeBid(user._id.toString(), {
        auctionId: auction._id.toString(),
        amount: BID_AMOUNT + index * 100, // Different amounts
        currentRound,
      }),
    );

    // Execute all bids concurrently
    await Promise.all(concurrentBids);

    // Verify all bids were created
    const allBids = await bidModel
      .find({
        auctionId: auction._id,
        status: BidStatus.ACTIVE,
      })
      .exec();

    expect(allBids.length).toBe(NUM_USERS);

    // Verify no duplicate active bids per user
    const userIds = allBids.map((bid) => bid.userId.toString());
    const uniqueUserIds = new Set(userIds);
    expect(userIds.length).toBe(uniqueUserIds.size);

    // Verify balances were locked correctly
    for (const user of users) {
      const updatedUser = await userModel.findById(user._id).exec();
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.balance).toBeLessThan(INITIAL_BALANCE);
      expect(updatedUser?.lockedBalance).toBeGreaterThan(0);
      expect((updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0)).toBe(INITIAL_BALANCE);
    }

    // Verify ledger entries were created
    const lockEntries = await ledgerEntryModel
      .find({ type: LedgerType.LOCK })
      .exec();
    expect(lockEntries.length).toBe(NUM_USERS);
  }, 30000);

  it('should update existing bid when same user places another bid', async () => {
    const user = users[0];
    const firstBidAmount = 1000;
    const secondBidAmount = 1500;

    // First bid
    await bidService.placeBid(user._id.toString(), {
      auctionId: auction._id.toString(),
      amount: firstBidAmount,
      currentRound: 0,
    });

    // Second bid from same user (should update existing bid)
    await bidService.placeBid(user._id.toString(), {
      auctionId: auction._id.toString(),
      amount: secondBidAmount,
      currentRound: 0,
    });

    // Verify only one active bid exists for this user
    const userBids = await bidModel
      .find({
        userId: user._id,
        auctionId: auction._id,
        status: BidStatus.ACTIVE,
      })
      .exec();

    expect(userBids.length).toBe(1);
    expect(userBids[0].amount).toBe(secondBidAmount);

    // Verify balance was locked correctly (only second amount should be locked)
    const updatedUser = await userModel.findById(user._id).exec();
    expect(updatedUser?.balance).toBe(INITIAL_BALANCE - secondBidAmount);
    expect(updatedUser?.lockedBalance).toBe(secondBidAmount);

    // Verify balance invariant
    expect((updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0)).toBe(INITIAL_BALANCE);
  }, 30000);

  it('should maintain balance invariants under concurrent load', async () => {
    const concurrentBids = users.map((user, index) =>
      bidService.placeBid(user._id.toString(), {
        auctionId: auction._id.toString(),
        amount: BID_AMOUNT + index * 50,
        currentRound: 0,
      }),
    );

    await Promise.all(concurrentBids);

    // Verify balance invariants for all users
    for (const user of users) {
      const updatedUser = await userModel.findById(user._id).exec();
      expect(updatedUser).toBeDefined();

      // balance >= 0
      expect(updatedUser?.balance).toBeGreaterThanOrEqual(0);
      // lockedBalance >= 0
      expect(updatedUser?.lockedBalance).toBeGreaterThanOrEqual(0);
      // balance + lockedBalance = INITIAL_BALANCE (constant)
      expect((updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0)).toBe(INITIAL_BALANCE);
    }

    // Verify all balance invariants using BalanceService
    for (const user of users) {
      const isValid = await balanceService.validateBalanceInvariants(
        user._id.toString(),
      );
      expect(isValid).toBe(true);
    }
  }, 30000);

  it('should prevent duplicate active bids with concurrent requests', async () => {
    const user = users[0];
    const bidAmount = 1000;

    // Place multiple concurrent bids from the same user
    // Use increasing amounts to avoid race condition where one transaction
    // completes with higher amount before another with lower amount
    const concurrentBids = Array.from({ length: 5 }, (_, index) =>
      bidService.placeBid(user._id.toString(), {
        auctionId: auction._id.toString(),
        amount: bidAmount + index * 10, // Increasing amounts: 1000, 1010, 1020, 1030, 1040
        currentRound: 0,
      }).catch((error) => {
        // Some bids may fail if another concurrent bid already updated with higher amount
        // This is expected behavior - only the highest bid should succeed
        if (
          error instanceof BadRequestException &&
          error.message.includes('must be greater than existing bid')
        ) {
          // This is expected - another concurrent bid already set a higher amount
          return null;
        }
        throw error;
      }),
    );

    const results = await Promise.all(concurrentBids);
    // At least one bid should succeed
    const successfulBids = results.filter((r) => r !== null);
    expect(successfulBids.length).toBeGreaterThan(0);

    // Verify only one active bid exists
    const userBids = await bidModel
      .find({
        userId: user._id,
        auctionId: auction._id,
        status: BidStatus.ACTIVE,
      })
      .exec();

    expect(userBids.length).toBe(1);

    // Verify balance was locked only once (should match the final bid amount)
    const updatedUser = await userModel.findById(user._id).exec();
    expect(updatedUser?.lockedBalance).toBeGreaterThanOrEqual(bidAmount);
    expect(updatedUser?.lockedBalance).toBeLessThan(bidAmount + 100);

    // Verify balance invariant
    expect((updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0)).toBe(INITIAL_BALANCE);
  }, 30000);

  it('should handle insufficient balance correctly under concurrent load', async () => {
    // Set users with low balances
    const lowBalanceUsers = users.slice(0, 3);
    for (const user of lowBalanceUsers) {
      await userModel.findByIdAndUpdate(user._id, {
        balance: 500, // Less than BID_AMOUNT
        lockedBalance: 0,
      });
    }

    const highBalanceUsers = users.slice(3);

    // Concurrent bids - some should fail (insufficient balance)
    const bidPromises = users.map((user, index) =>
      bidService
        .placeBid(user._id.toString(), {
          auctionId: auction._id.toString(),
          amount: BID_AMOUNT,
          currentRound: 0,
        })
        .catch((error) => {
          // Expected for low balance users
          return error;
        }),
    );

    await Promise.all(bidPromises);

    // Verify only high balance users have active bids
    const activeBids = await bidModel
      .find({
        auctionId: auction._id,
        status: BidStatus.ACTIVE,
      })
      .exec();

    const activeUserIds = activeBids.map((bid) => bid.userId.toString());
    const highBalanceUserIds = highBalanceUsers.map((user) => user._id.toString());

    // All active bids should be from high balance users
    for (const bidUserId of activeUserIds) {
      expect(highBalanceUserIds).toContain(bidUserId);
    }

    // Low balance users should not have active bids
    for (const user of lowBalanceUsers) {
      const userBids = await bidModel
        .find({
          userId: user._id,
          auctionId: auction._id,
          status: BidStatus.ACTIVE,
        })
        .exec();
      expect(userBids.length).toBe(0);
    }

    // Verify balance invariants for all users
    for (const user of users) {
      const updatedUser = await userModel.findById(user._id).exec();
      expect(updatedUser?.balance).toBeGreaterThanOrEqual(0);
      expect(updatedUser?.lockedBalance).toBeGreaterThanOrEqual(0);
      expect((updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0)).toBeLessThanOrEqual(
        INITIAL_BALANCE,
      );
    }
  }, 30000);
});

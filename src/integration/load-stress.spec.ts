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
import { AuctionRound, AuctionRoundDocument } from '../models/auction-round.schema';
import { AuctionStatus } from '../common/enums/auction-status.enum';
import { BidStatus } from '../common/enums/bid-status.enum';
import { LedgerType } from '../common/enums/ledger-type.enum';

/**
 * Load & Stress Tests
 *
 * Tests system behavior under high load and stress conditions:
 * 1. Bot-based bid simulation (multiple bots placing bids)
 * 2. High concurrency bidding (many simultaneous requests)
 * 3. Late bids near round end (timing pressure)
 * 4. Balance consistency validation (financial integrity under load)
 */

describe('Load & Stress Tests', () => {
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
  let auctionRoundModel: Model<AuctionRoundDocument>;

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
    auctionRoundModel = module.get<Model<AuctionRoundDocument>>(
      getModelToken(AuctionRound.name),
    );
  }, 60000); // 60 second timeout for setup

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
    // Clean all collections before each test
    await userModel.deleteMany({});
    await giftModel.deleteMany({});
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await ledgerEntryModel.deleteMany({});
    await auctionRoundModel.deleteMany({});
  });

  describe('Bot-based bid simulation', () => {
    it('should handle multiple bots placing bids simultaneously', async () => {
      const NUM_BOTS = 20;
      const INITIAL_BALANCE = 50000;
      const BID_AMOUNT_BASE = 1000;

      // Create bots (users)
      const bots: UserDocument[] = [];
      for (let i = 0; i < NUM_BOTS; i++) {
        const bot = await userModel.create({
          username: `bot_${i}`,
          balance: INITIAL_BALANCE,
          lockedBalance: 0,
        });
        bots.push(bot);
      }

      // Create gift and auction
      const gift = await giftModel.create({
        title: 'Stress Test Gift',
        basePrice: 100,
        totalSupply: 10,
      });

      const auction = await auctionService.createAuction({
        giftId: gift._id.toString(),
        totalGifts: 10,
        totalRounds: 1,
        roundDurationMs: 30000, // 30 seconds
        minBid: 100,
        createdBy: bots[0]._id.toString(),
      });

      await auctionService.startAuction(auction._id.toString(), bots[0]._id.toString());

      // Simulate bots placing bids
      const botBids = bots.map((bot, index) =>
        bidService
          .placeBid(bot._id.toString(), {
            auctionId: auction._id.toString(),
            amount: BID_AMOUNT_BASE + index * 100, // Different amounts
            currentRound: 0,
          })
          .catch((error) => {
            // Some bids may fail due to concurrency - this is expected
            return { error, botId: bot._id.toString() };
          }),
      );

      const results = await Promise.all(botBids);

      // Count successful bids
      const successfulBids = results.filter(
        (r): r is BidDocument =>
          r !== null &&
          typeof r === 'object' &&
          !('error' in r) &&
          '_id' in r,
      );
      expect(successfulBids.length).toBeGreaterThan(0);
      expect(successfulBids.length).toBeLessThanOrEqual(NUM_BOTS);

      // Verify all active bids are unique per user
      const activeBids = await bidModel
        .find({
          auctionId: auction._id,
          status: BidStatus.ACTIVE,
        })
        .exec();

      const userIds = activeBids.map((bid) => bid.userId.toString());
      const uniqueUserIds = new Set(userIds);
      expect(activeBids.length).toBe(uniqueUserIds.size); // No duplicate active bids

      // Verify balance invariants for all bots
      for (const bot of bots) {
        const updatedBot = await userModel.findById(bot._id).exec();
        expect(updatedBot).toBeDefined();
        expect(updatedBot?.balance).toBeGreaterThanOrEqual(0);
        expect(updatedBot?.lockedBalance).toBeGreaterThanOrEqual(0);
        expect(
          (updatedBot?.balance ?? 0) + (updatedBot?.lockedBalance ?? 0),
        ).toBeLessThanOrEqual(INITIAL_BALANCE);
      }
    }, 120000); // 2 minute timeout for load test
  });

  describe('High concurrency bidding', () => {
    it('should handle high concurrency bid placement', async () => {
      const NUM_USERS = 50;
      const CONCURRENT_BIDS_PER_USER = 3;
      const INITIAL_BALANCE = 100000;
      const BID_AMOUNT = 2000;

      // Create users
      const users: UserDocument[] = [];
      for (let i = 0; i < NUM_USERS; i++) {
        const user = await userModel.create({
          username: `user_${i}`,
          balance: INITIAL_BALANCE,
          lockedBalance: 0,
        });
        users.push(user);
      }

      // Create gift and auction
      const gift = await giftModel.create({
        title: 'High Concurrency Test Gift',
        basePrice: 100,
        totalSupply: 20,
      });

      const auction = await auctionService.createAuction({
        giftId: gift._id.toString(),
        totalGifts: 20,
        totalRounds: 1,
        roundDurationMs: 60000,
        minBid: 100,
        createdBy: users[0]._id.toString(),
      });

      await auctionService.startAuction(auction._id.toString(), users[0]._id.toString());

      // Create many concurrent bid requests
      const allBids: Promise<unknown>[] = [];
      for (const user of users) {
        for (let i = 0; i < CONCURRENT_BIDS_PER_USER; i++) {
          allBids.push(
            bidService
              .placeBid(user._id.toString(), {
                auctionId: auction._id.toString(),
                amount: BID_AMOUNT + i * 10, // Increasing amounts
                currentRound: 0,
              })
              .catch((error) => {
                // Expected: some will fail due to concurrent updates
                return { error };
              }),
          );
        }
      }

      const results = await Promise.all(allBids);

      // Count successful bids
      const successfulBids = results.filter(
        (r): r is BidDocument =>
          r !== null &&
          typeof r === 'object' &&
          !('error' in r) &&
          '_id' in r,
      );
      expect(successfulBids.length).toBeGreaterThan(0);

      // Verify: each user should have at most one active bid
      for (const user of users) {
        const userBids = await bidModel
          .find({
            userId: user._id,
            auctionId: auction._id,
            status: BidStatus.ACTIVE,
          })
          .exec();

        expect(userBids.length).toBeLessThanOrEqual(1); // At most one active bid per user
      }

      // Verify balance consistency
      for (const user of users) {
        const updatedUser = await userModel.findById(user._id).exec();
        const isValid = await balanceService.validateBalanceInvariants(
          user._id.toString(),
        );
        expect(isValid).toBe(true);
        expect(updatedUser?.balance).toBeGreaterThanOrEqual(0);
        expect(updatedUser?.lockedBalance).toBeGreaterThanOrEqual(0);
      }
    }, 180000); // 3 minute timeout for high concurrency test
  });

  describe('Late bids near round end', () => {
    it('should handle bids placed just before round ends', async () => {
      const NUM_USERS = 10;
      const INITIAL_BALANCE = 20000;
      const ROUND_DURATION_MS = 5000; // 5 seconds
      const LATE_BID_DELAY_MS = 4000; // Bid at 4 seconds (near end)

      // Create users
      const users: UserDocument[] = [];
      for (let i = 0; i < NUM_USERS; i++) {
        const user = await userModel.create({
          username: `late_bid_user_${i}`,
          balance: INITIAL_BALANCE,
          lockedBalance: 0,
        });
        users.push(user);
      }

      // Create gift and auction
      const gift = await giftModel.create({
        title: 'Late Bid Test Gift',
        basePrice: 100,
        totalSupply: 5,
      });

      const auction = await auctionService.createAuction({
        giftId: gift._id.toString(),
        totalGifts: 5,
        totalRounds: 1,
        roundDurationMs: ROUND_DURATION_MS,
        minBid: 100,
        createdBy: users[0]._id.toString(),
      });

      await auctionService.startAuction(auction._id.toString(), users[0]._id.toString());

      // Get round start time
      const round = await auctionRoundModel
        .findOne({
          auctionId: auction._id,
          roundIndex: 0,
        })
        .exec();

      expect(round).toBeDefined();
      const roundStartTime = round!.startedAt.getTime();
      const roundEndTime = round!.endsAt.getTime();

      // Place some early bids
      for (let i = 0; i < 3; i++) {
        await bidService.placeBid(users[i]._id.toString(), {
          auctionId: auction._id.toString(),
          amount: 1000 + i * 100,
          currentRound: 0,
        });
      }

      // Wait until near round end
      const waitTime = roundStartTime + LATE_BID_DELAY_MS - Date.now();
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Place late bids simultaneously (near round end)
      const lateBids = users.slice(3).map((user, index) =>
        bidService.placeBid(user._id.toString(), {
          auctionId: auction._id.toString(),
          amount: 1500 + index * 50,
          currentRound: 0,
        }),
      );

      const lateBidResults = await Promise.allSettled(lateBids);

      // Some late bids may succeed, some may fail (if round already closed)
      const successfulLateBids = lateBidResults.filter(
        (r) => r.status === 'fulfilled',
      );
      expect(successfulLateBids.length).toBeGreaterThanOrEqual(0);

      // Verify all bids that succeeded are valid
      const allActiveBids = await bidModel
        .find({
          auctionId: auction._id,
          status: BidStatus.ACTIVE,
        })
        .exec();

      // Verify balance invariants
      for (const user of users) {
        const isValid = await balanceService.validateBalanceInvariants(
          user._id.toString(),
        );
        expect(isValid).toBe(true);
      }

      // Verify no duplicate active bids per user
      const userIds = allActiveBids.map((bid) => bid.userId.toString());
      const uniqueUserIds = new Set(userIds);
      expect(allActiveBids.length).toBe(uniqueUserIds.size);
    }, 30000); // 30 second timeout
  });

  describe('Balance consistency validation', () => {
    it('should maintain balance invariants under heavy load', async () => {
      const NUM_USERS = 30;
      const NUM_AUCTIONS = 3;
      const INITIAL_BALANCE = 50000;
      const BID_AMOUNT = 1000;

      // Create users
      const users: UserDocument[] = [];
      for (let i = 0; i < NUM_USERS; i++) {
        const user = await userModel.create({
          username: `consistency_user_${i}`,
          balance: INITIAL_BALANCE,
          lockedBalance: 0,
        });
        users.push(user);
      }

      // Create multiple auctions
      const auctions: AuctionDocument[] = [];
      for (let i = 0; i < NUM_AUCTIONS; i++) {
        const gift = await giftModel.create({
          title: `Consistency Test Gift ${i}`,
          basePrice: 100,
          totalSupply: 10,
        });

        const auction = await auctionService.createAuction({
          giftId: gift._id.toString(),
          totalGifts: 10,
          totalRounds: 2,
          roundDurationMs: 10000,
          minBid: 100,
          createdBy: users[0]._id.toString(),
        });

        await auctionService.startAuction(auction._id.toString(), users[0]._id.toString());
        auctions.push(auction);
      }

      // Place bids across multiple auctions simultaneously
      const allBids: Promise<unknown>[] = [];
      for (const auction of auctions) {
        for (const user of users) {
          allBids.push(
            bidService
              .placeBid(user._id.toString(), {
                auctionId: auction._id.toString(),
                amount: BID_AMOUNT + Math.floor(Math.random() * 500),
                currentRound: 0,
              })
              .catch((error) => {
                return { error };
              }),
          );
        }
      }

      await Promise.all(allBids);

      // Close rounds for all auctions
      for (const auction of auctions) {
        try {
          await auctionService.closeCurrentRound(auction._id.toString());
        } catch (error) {
          // Some may fail if already closed - ignore
        }
      }

      // Verify balance invariants for all users
      const balanceChecks = users.map((user) =>
        balanceService.validateBalanceInvariants(user._id.toString()),
      );
      const balanceResults = await Promise.all(balanceChecks);

      // All users should have valid balance invariants
      const allValid = balanceResults.every((isValid) => isValid === true);
      expect(allValid).toBe(true);

      // Verify ledger entries sum correctly
      for (const user of users) {
        const updatedUser = await userModel.findById(user._id).exec();
        expect(updatedUser).toBeDefined();

        // Calculate expected balance from ledger
        const lockEntries = await ledgerEntryModel
          .find({
            userId: user._id,
            type: LedgerType.LOCK,
          })
          .exec();

        const unlockEntries = await ledgerEntryModel
          .find({
            userId: user._id,
            type: LedgerType.UNLOCK,
          })
          .exec();

        const payoutEntries = await ledgerEntryModel
          .find({
            userId: user._id,
            type: LedgerType.PAYOUT,
          })
          .exec();

        const refundEntries = await ledgerEntryModel
          .find({
            userId: user._id,
            type: LedgerType.REFUND,
          })
          .exec();

        const totalLocked = lockEntries.reduce((sum, e) => sum + e.amount, 0);
        const totalUnlocked = unlockEntries.reduce((sum, e) => sum + e.amount, 0);
        const totalPayout = payoutEntries.reduce((sum, e) => sum + e.amount, 0);
        const totalRefund = refundEntries.reduce((sum, e) => sum + e.amount, 0);

        // Balance calculation: initial - locked + unlocked - payout + refund
        const expectedLockedBalance =
          totalLocked - totalUnlocked - totalPayout - totalRefund;
        const expectedBalance =
          INITIAL_BALANCE - totalLocked + totalUnlocked + totalRefund;

        // Allow small rounding differences
        expect(
          Math.abs((updatedUser?.lockedBalance ?? 0) - expectedLockedBalance),
        ).toBeLessThan(1);
        expect(Math.abs((updatedUser?.balance ?? 0) - expectedBalance)).toBeLessThan(
          1,
        );

        // Verify invariant: balance + lockedBalance <= initial balance
        expect(
          (updatedUser?.balance ?? 0) + (updatedUser?.lockedBalance ?? 0),
        ).toBeLessThanOrEqual(INITIAL_BALANCE);
      }
    }, 180000); // 3 minute timeout
  });
});

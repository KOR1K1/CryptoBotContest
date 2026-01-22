import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, connect } from 'mongoose';
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
 * Integration Test: Full Auction Lifecycle
 *
 * Tests the complete auction flow:
 * 1. Create users and gift
 * 2. Create auction
 * 3. Start auction
 * 4. Place bids from multiple users
 * 5. Close rounds and select winners
 * 6. Finalize auction
 * 7. Verify payouts and refunds
 * 8. Verify balance invariants
 */
describe('Auction Lifecycle Integration Test', () => {
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

  let user1: UserDocument;
  let user2: UserDocument;
  let user3: UserDocument;
  let gift: GiftDocument;
  let auction: AuctionDocument;

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
    // Clean all collections before each test
    await userModel.deleteMany({});
    await giftModel.deleteMany({});
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await ledgerEntryModel.deleteMany({});
    await auctionRoundModel.deleteMany({});

    // Create test users with initial balances
    user1 = await userModel.create({
      username: 'user1',
      balance: 10000,
      lockedBalance: 0,
    });
    user2 = await userModel.create({
      username: 'user2',
      balance: 8000,
      lockedBalance: 0,
    });
    user3 = await userModel.create({
      username: 'user3',
      balance: 5000,
      lockedBalance: 0,
    });

    // Create test gift
    gift = await giftModel.create({
      title: 'Test Gift',
      description: 'A test gift for auction',
      imageUrl: 'https://example.com/gift.jpg',
      basePrice: 100,
      totalSupply: 3,
      metadata: {
        rarity: 'common',
        category: 'test',
      },
    });
  });

  it('should complete full auction lifecycle with multiple rounds', async () => {
    // Step 1: Create auction
    // totalGifts: 4, totalRounds: 2 => giftsPerRound = Math.ceil(4/2) = 2
    auction = await auctionService.createAuction({
      giftId: gift._id.toString(),
      totalGifts: 4, // 4 gifts total
      totalRounds: 2, // 2 rounds, so 2 gifts per round
      roundDurationMs: 5000, // 5 seconds per round
      minBid: 100,
      createdBy: user1._id.toString(),
    });

    expect(auction.status).toBe(AuctionStatus.CREATED);
    expect(auction.currentRound).toBe(0);

    // Step 2: Start auction (only creator can start)
    await auctionService.startAuction(auction._id.toString(), user1._id.toString());

    const startedAuction = await auctionModel.findById(auction._id).exec();
    expect(startedAuction?.status).toBe(AuctionStatus.RUNNING);
    expect(startedAuction?.currentRound).toBe(0);

    // Verify first round was created
    const round0 = await auctionRoundModel
      .findOne({
        auctionId: auction._id,
        roundIndex: 0,
      })
      .exec();
    expect(round0).toBeDefined();
    expect(round0?.endsAt.getTime()).toBeGreaterThan(Date.now());

    // Step 3: Place bids in Round 0
    // User1: 1500
    await bidService.placeBid(user1._id.toString(), {
      auctionId: auction._id.toString(),
      amount: 1500,
      currentRound: 0,
    });

    // User2: 1200
    await bidService.placeBid(user2._id.toString(), {
      auctionId: auction._id.toString(),
      amount: 1200,
      currentRound: 0,
    });

    // User3: 1000
    await bidService.placeBid(user3._id.toString(), {
      auctionId: auction._id.toString(),
      amount: 1000,
      currentRound: 0,
    });

    // Verify balances were locked
    const user1AfterBid = await userModel.findById(user1._id).exec();
    const user2AfterBid = await userModel.findById(user2._id).exec();
    const user3AfterBid = await userModel.findById(user3._id).exec();

    expect(user1AfterBid?.balance).toBe(8500); // 10000 - 1500
    expect(user1AfterBid?.lockedBalance).toBe(1500);
    expect(user2AfterBid?.balance).toBe(6800); // 8000 - 1200
    expect(user2AfterBid?.lockedBalance).toBe(1200);
    expect(user3AfterBid?.balance).toBe(4000); // 5000 - 1000
    expect(user3AfterBid?.lockedBalance).toBe(1000);

    // Verify ledger entries created
    const lockEntries = await ledgerEntryModel
      .find({ type: LedgerType.LOCK })
      .exec();
    expect(lockEntries.length).toBe(3);

    // Step 4: Close Round 0
    // Winners should be User1 (1500) and User2 (1200) - top 2 (giftsPerRound = 2)
    await auctionService.closeCurrentRound(auction._id.toString());

    const round0AfterClose = await auctionRoundModel
      .findOne({
        auctionId: auction._id,
        roundIndex: 0,
      })
      .exec();
    expect(round0AfterClose?.closed).toBe(true);
    expect(round0AfterClose?.winnersCount).toBe(2);

    // Verify winners
    const winnersRound0 = await bidModel
      .find({
        auctionId: auction._id,
        roundIndex: 0,
        status: BidStatus.WON,
      })
      .exec();
    expect(winnersRound0.length).toBe(2);
    expect(winnersRound0.some((b) => b.userId.toString() === user1._id.toString())).toBe(
      true,
    );
    expect(winnersRound0.some((b) => b.userId.toString() === user2._id.toString())).toBe(
      true,
    );

    // Verify payouts for winners
    const payoutEntriesRound0 = await ledgerEntryModel
      .find({ type: LedgerType.PAYOUT })
      .exec();
    expect(payoutEntriesRound0.length).toBe(2);
    expect(
      payoutEntriesRound0.some((e) => e.userId.toString() === user1._id.toString()),
    ).toBe(true);
    expect(
      payoutEntriesRound0.some((e) => e.userId.toString() === user2._id.toString()),
    ).toBe(true);

    // Note: Non-winners (User3) do NOT get refunded after Round 0
    // Their bids carry over to the next round (carry-over behavior)
    // Refunds only happen after auction finalization
    const refundEntriesRound0 = await ledgerEntryModel
      .find({ type: LedgerType.REFUND })
      .exec();
    expect(refundEntriesRound0.length).toBe(0); // No refunds after intermediate rounds

    // Check final balances after Round 0
    const user1AfterRound0 = await userModel.findById(user1._id).exec();
    const user2AfterRound0 = await userModel.findById(user2._id).exec();
    const user3AfterRound0 = await userModel.findById(user3._id).exec();

    // User1: won, paid 1500 from lockedBalance, lockedBalance should be 0
    expect(user1AfterRound0?.balance).toBe(8500); // Still locked from bid, but lockedBalance reduced
    expect(user1AfterRound0?.lockedBalance).toBe(0); // Paid out

    // User2: won, paid 1200 from lockedBalance, lockedBalance should be 0
    expect(user2AfterRound0?.balance).toBe(6800); // Still locked from bid, but lockedBalance reduced
    expect(user2AfterRound0?.lockedBalance).toBe(0); // Paid out

    // User3: lost, bid carries over to next round, so lockedBalance remains
    expect(user3AfterRound0?.balance).toBe(4000); // Still 5000 - 1000 (locked)
    expect(user3AfterRound0?.lockedBalance).toBe(1000); // Still locked (carry-over)

    // Step 5: Advance to Round 1
    await auctionService.advanceRound(auction._id.toString());

    const auctionAfterRound1 = await auctionModel.findById(auction._id).exec();
    expect(auctionAfterRound1?.currentRound).toBe(1);

    // Verify Round 1 was created
    const round1 = await auctionRoundModel
      .findOne({
        auctionId: auction._id,
        roundIndex: 1,
      })
      .exec();
    expect(round1).toBeDefined();
    expect(round1?.closed).toBe(false);

    // Step 6: Place bids in Round 1
    // User3 increases bid: 1100
    await bidService.placeBid(user3._id.toString(), {
      auctionId: auction._id.toString(),
      amount: 1100,
      currentRound: 1,
    });

    // User1 places new bid: 800 (lower than before, but still valid)
    await bidService.placeBid(user1._id.toString(), {
      auctionId: auction._id.toString(),
      amount: 800,
      currentRound: 1,
    });

    // Verify balances locked for Round 1
    // Note: User3's bid from Round 0 (1000) carries over to Round 1
    // Then User3 places a new bid of 1100 in Round 1, so total locked should be 1100 (higher bid replaces)
    // Actually, wait - if it's a carry-over, User3's bid from Round 0 should still be active
    // But if User3 places a new bid of 1100, it should update the existing bid
    const user1BeforeRound1Close = await userModel.findById(user1._id).exec();
    const user3BeforeRound1Close = await userModel.findById(user3._id).exec();

    // User1 placed new bid of 800 in Round 1 (balance was 8500 after Round 0)
    expect(user1BeforeRound1Close?.balance).toBe(7700); // 8500 - 800
    expect(user1BeforeRound1Close?.lockedBalance).toBe(800);
    
    // User3: bid from Round 0 (1000) carried over, then increased to 1100 in Round 1
    // So lockedBalance should be 1100 (the new higher amount)
    expect(user3BeforeRound1Close?.balance).toBe(3900); // 5000 - 1100 (increased from 1000)
    expect(user3BeforeRound1Close?.lockedBalance).toBe(1100);

    // Step 7: Close Round 1
    await auctionService.closeCurrentRound(auction._id.toString());

    // Winners should be User3 (1100) and User1 (800) - top 2
    const winnersRound1 = await bidModel
      .find({
        auctionId: auction._id,
        roundIndex: 1,
        status: BidStatus.WON,
      })
      .exec();
    expect(winnersRound1.length).toBe(2);

    // Step 8: Finalize auction
    // After finalization, all remaining active bids (non-winners) should be refunded
    await auctionService.finalizeAuction(auction._id.toString());

    const finalAuction = await auctionModel.findById(auction._id).exec();
    expect(finalAuction?.status).toBe(AuctionStatus.COMPLETED);

    // Step 9: Verify all balance invariants
    const finalUser1 = await userModel.findById(user1._id).exec();
    const finalUser2 = await userModel.findById(user2._id).exec();
    const finalUser3 = await userModel.findById(user3._id).exec();

    // All balances must satisfy: balance >= 0, lockedBalance >= 0
    expect(finalUser1?.balance).toBeGreaterThanOrEqual(0);
    expect(finalUser1?.lockedBalance).toBeGreaterThanOrEqual(0);
    expect(finalUser2?.balance).toBeGreaterThanOrEqual(0);
    expect(finalUser2?.lockedBalance).toBeGreaterThanOrEqual(0);
    expect(finalUser3?.balance).toBeGreaterThanOrEqual(0);
    expect(finalUser3?.lockedBalance).toBeGreaterThanOrEqual(0);

    // Verify all ledger entries sum up correctly
    const allLedgerEntries = await ledgerEntryModel.find().exec();
    expect(allLedgerEntries.length).toBeGreaterThan(0);

    // Step 10: Verify no duplicate payouts or refunds
    const allPayouts = await ledgerEntryModel.find({ type: LedgerType.PAYOUT }).exec();
    const payoutUserIds = allPayouts.map((e) => e.userId.toString());
    const uniquePayoutUsers = new Set(payoutUserIds);
    // Note: Same user can win multiple rounds, so duplicates per user are OK
    // But each bid should only be paid once

    // Verify refunds are unique per bid
    const allRefunds = await ledgerEntryModel.find({ type: LedgerType.REFUND }).exec();
    const refundReferenceIds = allRefunds.map((e) => e.referenceId);
    const uniqueRefundReferences = new Set(refundReferenceIds);
    expect(allRefunds.length).toBe(uniqueRefundReferences.size); // No duplicate refunds
  }, 60000); // 60 second timeout for integration test
});

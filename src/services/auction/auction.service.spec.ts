import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { BalanceService } from '../balance/balance.service';
import { BidService } from '../bid/bid.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { AuctionRound, AuctionRoundDocument } from '../../models/auction-round.schema';
import { Bid, BidDocument } from '../../models/bid.schema';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { BidStatus } from '../../common/enums/bid-status.enum';

describe('AuctionService', () => {
  let service: AuctionService;
  let auctionModel: any;
  let auctionRoundModel: any;
  let bidModel: any;
  let balanceService: any;
  let bidService: any;
  let redisLockService: any;
  let connection: any;

  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
    withTransaction: jest.fn((callback: () => Promise<void>) => callback()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionService,
        {
          provide: getModelToken(Auction.name),
          useValue: {
            findById: jest.fn(),
            create: jest.fn(),
            findByIdAndUpdate: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getModelToken(AuctionRound.name),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            find: jest.fn(),
            findByIdAndUpdate: jest.fn(),
          },
        },
        {
          provide: getModelToken(Bid.name),
          useValue: {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  session: jest.fn().mockReturnValue({
                    exec: jest.fn(),
                  }),
                  exec: jest.fn(),
                }),
                session: jest.fn().mockReturnValue({
                  exec: jest.fn(),
                }),
                exec: jest.fn(),
              }),
            }),
            findByIdAndUpdate: jest.fn(),
          },
        },
        {
          provide: BalanceService,
          useValue: {
            payout: jest.fn(),
            refund: jest.fn(),
          },
        },
        {
          provide: BidService,
          useValue: {
            getActiveBidsForAuction: jest.fn(),
          },
        },
        {
          provide: RedisLockService,
          useValue: {
            isLockServiceAvailable: jest.fn().mockReturnValue(false),
            withLock: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn(() => mockSession),
          },
        },
      ],
    }).compile();

    service = module.get<AuctionService>(AuctionService);
    auctionModel = module.get(getModelToken(Auction.name));
    auctionRoundModel = module.get(getModelToken(AuctionRound.name));
    bidModel = module.get(getModelToken(Bid.name));
    balanceService = module.get(BalanceService);
    bidService = module.get(BidService);
    redisLockService = module.get(RedisLockService);
    connection = module.get(getConnectionToken());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAuction', () => {
    it('should create auction with valid parameters', async () => {
      const dto = {
        giftId: 'gift123',
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
        createdBy: 'user123',
      };

      const mockAuction = {
        _id: 'auction123',
        ...dto,
        status: AuctionStatus.CREATED,
        currentRound: 0,
      };

      auctionModel.create.mockResolvedValue(mockAuction);

      const result = await service.createAuction(dto);

      expect(auctionModel.create).toHaveBeenCalledWith({
        giftId: dto.giftId,
        status: AuctionStatus.CREATED,
        totalGifts: dto.totalGifts,
        totalRounds: dto.totalRounds,
        currentRound: 0,
        roundDurationMs: dto.roundDurationMs,
        minBid: dto.minBid,
        createdBy: dto.createdBy,
      });
      expect(result).toEqual(mockAuction);
    });

    it('should throw BadRequestException when totalGifts is zero or negative', async () => {
      const dto = {
        giftId: 'gift123',
        totalGifts: 0,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
        createdBy: 'user123',
      };

      await expect(service.createAuction(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when totalRounds is zero or negative', async () => {
      const dto = {
        giftId: 'gift123',
        totalGifts: 10,
        totalRounds: 0,
        roundDurationMs: 60000,
        minBid: 100,
        createdBy: 'user123',
      };

      await expect(service.createAuction(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when roundDurationMs is less than 1000ms', async () => {
      const dto = {
        giftId: 'gift123',
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 500,
        minBid: 100,
        createdBy: 'user123',
      };

      await expect(service.createAuction(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when minBid is zero or negative', async () => {
      const dto = {
        giftId: 'gift123',
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 0,
        createdBy: 'user123',
      };

      await expect(service.createAuction(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('startAuction', () => {
    it('should start auction and create first round', async () => {
      const auctionId = 'auction123';
      const userId = 'user123';
      const mockAuction = {
        _id: auctionId,
        giftId: 'gift123',
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
        status: AuctionStatus.CREATED,
        currentRound: 0,
        createdBy: userId,
      };

      const mockUpdatedAuction = {
        ...mockAuction,
        status: AuctionStatus.RUNNING,
        startedAt: new Date(),
        currentRound: 0,
      };

      auctionModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockAuction),
        }),
      });

      auctionRoundModel.create.mockResolvedValue([{}]);

      auctionModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUpdatedAuction),
      });

      const result = await service.startAuction(auctionId, userId);

      expect(auctionModel.findById).toHaveBeenCalledWith(auctionId);
      expect(auctionRoundModel.create).toHaveBeenCalled();
      expect(auctionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        auctionId,
        expect.objectContaining({
          status: AuctionStatus.RUNNING,
          currentRound: 0,
        }),
        expect.any(Object),
      );
      expect(result.status).toBe(AuctionStatus.RUNNING);
    });

    it('should throw NotFoundException when auction not found', async () => {
      const auctionId = 'nonexistent';
      const userId = 'user123';

      auctionModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.startAuction(auctionId, userId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when auction is not in CREATED status', async () => {
      const auctionId = 'auction123';
      const userId = 'user123';
      const mockAuction = {
        _id: auctionId,
        status: AuctionStatus.RUNNING, // Already running
        createdBy: userId,
      };

      auctionModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockAuction),
        }),
      });

      await expect(service.startAuction(auctionId, userId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('calculateWinners', () => {
    it('should select winners by highest amount (descending)', async () => {
      const mockBids = [
        {
          _id: 'bid1',
          userId: 'user1',
          amount: 500,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          _id: 'bid2',
          userId: 'user2',
          amount: 1000, // Highest
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          _id: 'bid3',
          userId: 'user3',
          amount: 300,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          _id: 'bid4',
          userId: 'user4',
          amount: 800,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
      ];

      // Mock must return bids sorted by amount DESC, createdAt ASC
      const sortedBids = [...mockBids].sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount; // amount DESC
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // createdAt ASC
      });

      bidModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            session: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 2)),
            }),
            exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 2)),
          }),
        }),
      });

      const winners = await service.calculateWinners('auction123', 0, 2);

      expect(winners).toHaveLength(2);
      expect(winners[0].amount).toBe(1000); // Highest amount first
      expect(winners[1].amount).toBe(800); // Second highest
    });

    it('should break ties by earliest createdAt (ascending)', async () => {
      const mockBids = [
        {
          _id: 'bid1',
          userId: 'user1',
          amount: 500,
          createdAt: new Date('2024-01-01T10:01:00Z'), // Later
        },
        {
          _id: 'bid2',
          userId: 'user2',
          amount: 500, // Same amount
          createdAt: new Date('2024-01-01T10:00:00Z'), // Earlier - should win
        },
        {
          _id: 'bid3',
          userId: 'user3',
          amount: 500,
          createdAt: new Date('2024-01-01T10:02:00Z'), // Latest
        },
      ];

      // Mock must return bids sorted by amount DESC, createdAt ASC
      const sortedBids = [...mockBids].sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount; // amount DESC
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // createdAt ASC
      });

      bidModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            session: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 1)),
            }),
            exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 1)),
          }),
        }),
      });

      const winners = await service.calculateWinners('auction123', 0, 1);

      expect(winners).toHaveLength(1);
      expect(winners[0]._id).toBe('bid2'); // Earliest createdAt wins
      expect(winners[0].createdAt.getTime()).toBeLessThan(
        mockBids[0].createdAt.getTime(),
      );
    });

    it('should return empty array when no active bids', async () => {
      bidModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            session: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([]),
            }),
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const winners = await service.calculateWinners('auction123', 0, 5);

      expect(winners).toHaveLength(0);
    });

    it('should select only giftsPerRound winners', async () => {
      const mockBids = Array.from({ length: 10 }, (_, i) => ({
        _id: `bid${i}`,
        userId: `user${i}`,
        amount: 1000 - i * 10, // Decreasing amounts
        createdAt: new Date(`2024-01-01T10:0${i}:00Z`),
      }));

      // Mock must return bids sorted by amount DESC, createdAt ASC
      const sortedBids = [...mockBids].sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount; // amount DESC
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // createdAt ASC
      });

      bidModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            session: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 3)),
            }),
            exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 3)),
          }),
        }),
      });

      const giftsPerRound = 3;
      const winners = await service.calculateWinners('auction123', 0, giftsPerRound);

      expect(winners).toHaveLength(giftsPerRound);
      expect(winners[0].amount).toBe(1000);
      expect(winners[1].amount).toBe(990);
      expect(winners[2].amount).toBe(980);
    });

    it('should be deterministic - same inputs produce same results', async () => {
      const mockBids = [
        {
          _id: 'bid1',
          userId: 'user1',
          amount: 500,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          _id: 'bid2',
          userId: 'user2',
          amount: 1000,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          _id: 'bid3',
          userId: 'user3',
          amount: 500,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
      ];

      // Mock must return bids sorted by amount DESC, createdAt ASC
      const sortedBids = [...mockBids].sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount; // amount DESC
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // createdAt ASC
      });

      bidModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            session: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 2)),
            }),
            exec: jest.fn().mockResolvedValue(sortedBids.slice(0, 2)),
          }),
        }),
      });

      const winners1 = await service.calculateWinners('auction123', 0, 2);
      const winners2 = await service.calculateWinners('auction123', 0, 2);

      expect(winners1).toHaveLength(winners2.length);
      expect(winners1[0]._id).toBe(winners2[0]._id);
      expect(winners1[1]._id).toBe(winners2[1]._id);
    });
  });
});


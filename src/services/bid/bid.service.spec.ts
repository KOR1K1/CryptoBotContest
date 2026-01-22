import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { BidService } from './bid.service';
import { BalanceService } from '../balance/balance.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';
import { Bid, BidDocument } from '../../models/bid.schema';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { AuctionStatus } from '../../common/enums/auction-status.enum';

describe('BidService', () => {
  let service: BidService;
  let bidModel: any;
  let auctionModel: any;
  let balanceService: any;
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
        BidService,
        {
          provide: getModelToken(Bid.name),
          useValue: {
            findOne: jest.fn().mockReturnValue({
              session: jest.fn().mockReturnValue({
                exec: jest.fn(),
              }),
              exec: jest.fn(),
            }),
            create: jest.fn(),
            findByIdAndUpdate: jest.fn().mockReturnValue({
              exec: jest.fn(),
            }),
            findById: jest.fn().mockReturnValue({
              session: jest.fn().mockReturnValue({
                exec: jest.fn(),
              }),
              exec: jest.fn(),
            }),
            find: jest.fn(),
          },
        },
        {
          provide: getModelToken(Auction.name),
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: BalanceService,
          useValue: {
            validateBalance: jest.fn(),
            lockFunds: jest.fn(),
            unlockFunds: jest.fn(),
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

    service = module.get<BidService>(BidService);
    bidModel = module.get(getModelToken(Bid.name));
    auctionModel = module.get(getModelToken(Auction.name));
    balanceService = module.get(BalanceService);
    redisLockService = module.get(RedisLockService);
    connection = module.get(getConnectionToken());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateBid', () => {
    it('should validate bid with valid parameters', async () => {
      const mockAuction = {
        _id: 'auction123',
        status: AuctionStatus.RUNNING,
        minBid: 100,
      };

      auctionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAuction),
      });

      const result = await service.validateBid('auction123', 'user123', 150);

      expect(result).toEqual(mockAuction);
      expect(auctionModel.findById).toHaveBeenCalledWith('auction123');
    });

    it('should throw BadRequestException when amount is zero or negative', async () => {
      await expect(service.validateBid('auction123', 'user123', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.validateBid('auction123', 'user123', -100)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when auction not found', async () => {
      auctionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.validateBid('nonexistent', 'user123', 150)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when auction is not running', async () => {
      const mockAuction = {
        _id: 'auction123',
        status: AuctionStatus.CREATED,
        minBid: 100,
      };

      auctionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAuction),
      });

      await expect(service.validateBid('auction123', 'user123', 150)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when amount is below minimum bid', async () => {
      const mockAuction = {
        _id: 'auction123',
        status: AuctionStatus.RUNNING,
        minBid: 100,
      };

      auctionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAuction),
      });

      await expect(service.validateBid('auction123', 'user123', 50)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('preventDuplicateActiveBid', () => {
    it('should return existing active bid if found', async () => {
      const mockBid = {
        _id: 'bid123',
        userId: 'user123',
        auctionId: 'auction123',
        amount: 100,
        status: BidStatus.ACTIVE,
      };

      bidModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockBid),
      });

      const result = await service.preventDuplicateActiveBid('user123', 'auction123');

      expect(result).toEqual(mockBid);
      expect(bidModel.findOne).toHaveBeenCalledWith({
        userId: 'user123',
        auctionId: 'auction123',
        status: BidStatus.ACTIVE,
      });
    });

    it('should return null when no active bid found', async () => {
      bidModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.preventDuplicateActiveBid('user123', 'auction123');

      expect(result).toBeNull();
    });
  });

  describe('placeBid', () => {
    const mockAuction = {
      _id: 'auction123',
      status: AuctionStatus.RUNNING,
      minBid: 100,
      currentRound: 0,
    };

    beforeEach(() => {
      auctionModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAuction),
      });
    });

    it('should create new bid when user has no existing bid', async () => {
      const dto = {
        userId: 'user123',
        auctionId: 'auction123',
        amount: 150,
        currentRound: 0,
      };

      bidModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null), // No existing bid
        }),
        exec: jest.fn().mockResolvedValue(null), // No existing bid
      });

      balanceService.validateBalance.mockResolvedValue(true);
      balanceService.lockFunds.mockResolvedValue(undefined);

      const mockBid = {
        _id: 'bid123',
        ...dto,
        status: BidStatus.ACTIVE,
        roundIndex: 0,
      };

      bidModel.create.mockResolvedValue([mockBid]);

      bidModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockBid),
        }),
        exec: jest.fn().mockResolvedValue(mockBid),
      });

      const { userId, ...bidDto } = dto;
      const result = await service.placeBid(userId, bidDto);

      expect(bidModel.findOne).toHaveBeenCalled();
      expect(balanceService.validateBalance).toHaveBeenCalledWith('user123', 150);
      expect(balanceService.lockFunds).toHaveBeenCalledWith(
        'user123',
        150,
        expect.any(String), // referenceId (bidId)
        expect.any(String), // description
        expect.any(Object), // session
      );
      expect(bidModel.create).toHaveBeenCalled();
    });

    it('should increase existing bid when user has active bid', async () => {
      const dto = {
        userId: 'user123',
        auctionId: 'auction123',
        amount: 200, // Increased from 150
        currentRound: 0,
      };

      const existingBid = {
        _id: 'bid123',
        userId: 'user123',
        auctionId: 'auction123',
        amount: 150,
        status: BidStatus.ACTIVE,
        roundIndex: 0,
      };

      bidModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existingBid),
        }),
        exec: jest.fn().mockResolvedValue(existingBid),
      });

      balanceService.validateBalance.mockResolvedValue(true);
      balanceService.lockFunds.mockResolvedValue(undefined);

      const updatedBid = {
        ...existingBid,
        amount: 200,
      };

      bidModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedBid),
      });

      bidModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedBid),
        }),
        exec: jest.fn().mockResolvedValue(updatedBid),
      });

      const { userId, ...bidDto } = dto;
      const result = await service.placeBid(userId, bidDto);

      expect(balanceService.validateBalance).toHaveBeenCalledWith('user123', 50); // Delta: 200 - 150
      expect(balanceService.lockFunds).toHaveBeenCalledWith(
        'user123',
        50,
        expect.any(String), // referenceId (bidId)
        expect.any(String), // description
        expect.any(Object), // session
      );
      expect(bidModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('should throw BadRequestException when new amount is not greater than existing', async () => {
      const dto = {
        userId: 'user123',
        auctionId: 'auction123',
        amount: 100, // Less than existing
        currentRound: 0,
      };

      const existingBid = {
        _id: 'bid123',
        amount: 150,
        status: BidStatus.ACTIVE,
      };

      bidModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existingBid),
        }),
        exec: jest.fn().mockResolvedValue(existingBid),
      });

      const { userId, ...bidDto } = dto;
      await expect(service.placeBid(userId, bidDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user has insufficient balance', async () => {
      const dto = {
        userId: 'user123',
        auctionId: 'auction123',
        amount: 150,
        currentRound: 0,
      };

      bidModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
        exec: jest.fn().mockResolvedValue(null),
      });

      balanceService.validateBalance.mockResolvedValue(false);

      const { userId, ...bidDto } = dto;
      await expect(service.placeBid(userId, bidDto)).rejects.toThrow(BadRequestException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { BalanceService } from './balance.service';
import { User, UserDocument } from '../../models/user.schema';
import { LedgerEntry, LedgerEntryDocument } from '../../models/ledger-entry.schema';
import { LedgerType } from '../../common/enums/ledger-type.enum';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('BalanceService', () => {
  let service: BalanceService;
  let userModel: any;
  let ledgerEntryModel: any;
  let connection: any;

  const mockUser = {
    _id: 'user123',
    username: 'testuser',
    balance: 1000,
    lockedBalance: 0,
    save: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn(() => ({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
      withTransaction: jest.fn((callback) => callback()),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: getModelToken(User.name),
          useValue: {
            findById: jest.fn(),
            findOne: jest.fn(),
            findByIdAndUpdate: jest.fn(),
          },
        },
        {
          provide: getModelToken(LedgerEntry.name),
          useValue: {
            create: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    userModel = module.get(getModelToken(User.name));
    ledgerEntryModel = module.get(getModelToken(LedgerEntry.name));
    connection = module.get(getConnectionToken());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateBalance', () => {
    it('should return true when user has sufficient balance', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockUser,
          balance: 1000,
        }),
      });

      const result = await service.validateBalance('user123', 500);
      expect(result).toBe(true);
    });

    it('should return false when user has insufficient balance', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockUser,
          balance: 100,
        }),
      });

      const result = await service.validateBalance('user123', 500);
      expect(result).toBe(false);
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.validateBalance('nonexistent', 100)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when amount is zero or negative', async () => {
      await expect(service.validateBalance('user123', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.validateBalance('user123', -100)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('lockFunds', () => {
    it('should lock funds and maintain balance invariants', async () => {
      const userBefore = {
        ...mockUser,
        balance: 1000,
        lockedBalance: 0,
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        withTransaction: jest.fn((callback) => callback()),
      };

      mockConnection.startSession.mockReturnValue(session);

      const userAfter = {
        ...userBefore,
        balance: 800,
        lockedBalance: 200,
      };

      userModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userBefore),
        }),
      });

      userModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userAfter),
      });

      ledgerEntryModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null), // No existing entry
        }),
      });

      ledgerEntryModel.create.mockResolvedValue([{}]);

      const result = await service.lockFunds('user123', 200, 'bid123');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(ledgerEntryModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: 'user123',
            type: LedgerType.LOCK,
            amount: 200,
            referenceId: 'bid123',
          }),
        ],
        expect.any(Object),
      );

      // Verify invariants: balance + lockedBalance = constant
      expect(userAfter.balance).toBe(800);
      expect(userAfter.lockedBalance).toBe(200);
      expect(userAfter.balance + userAfter.lockedBalance).toBe(1000);
    });

    it('should throw BadRequestException when insufficient balance', async () => {
      const user = {
        ...mockUser,
        balance: 100,
        lockedBalance: 0,
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        withTransaction: jest.fn((callback) => callback()),
      };

      mockConnection.startSession.mockReturnValue(session);

      userModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(user),
        }),
      });

      await expect(service.lockFunds('user123', 200, 'bid123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when amount is zero or negative', async () => {
      await expect(service.lockFunds('user123', 0, 'bid123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.lockFunds('user123', -100, 'bid123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('unlockFunds', () => {
    it('should unlock funds and maintain balance invariants', async () => {
      const userBefore = {
        ...mockUser,
        balance: 800,
        lockedBalance: 200,
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        withTransaction: jest.fn((callback) => callback()),
      };

      mockConnection.startSession.mockReturnValue(session);

      const userAfter = {
        ...userBefore,
        balance: 1000,
        lockedBalance: 0,
      };

      userModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userBefore),
        }),
      });

      userModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userAfter),
      });

      ledgerEntryModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null), // No existing entry
        }),
      });

      ledgerEntryModel.create.mockResolvedValue([{}]);

      const result = await service.unlockFunds('user123', 200, 'bid123');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(ledgerEntryModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: 'user123',
            type: LedgerType.UNLOCK,
            amount: 200,
            referenceId: 'bid123',
          }),
        ],
        expect.any(Object),
      );

      // Verify invariants: balance + lockedBalance = constant
      expect(userAfter.balance).toBe(1000);
      expect(userAfter.lockedBalance).toBe(0);
      expect(userAfter.balance + userAfter.lockedBalance).toBe(1000);
    });
  });

  describe('refund', () => {
    it('should refund funds and maintain balance invariants', async () => {
      const userBefore = {
        ...mockUser,
        balance: 800,
        lockedBalance: 200,
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        withTransaction: jest.fn((callback) => callback()),
      };

      mockConnection.startSession.mockReturnValue(session);

      const userAfter = {
        ...userBefore,
        balance: 1000,
        lockedBalance: 0,
      };

      userModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userBefore),
        }),
      });

      userModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userAfter),
      });

      ledgerEntryModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null), // No existing entry
        }),
      });

      ledgerEntryModel.create.mockResolvedValue([{}]);

      const result = await service.refund('user123', 200, 'auction123');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(ledgerEntryModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: 'user123',
            type: LedgerType.REFUND,
            amount: 200,
            referenceId: 'auction123',
          }),
        ],
        expect.any(Object),
      );

      // Verify invariants: balance + lockedBalance = constant (refund restores balance)
      expect(userAfter.balance).toBe(1000);
      expect(userAfter.lockedBalance).toBe(0);
      expect(userAfter.balance + userAfter.lockedBalance).toBe(1000);
    });

    it('should be idempotent - skip if refund already processed', async () => {
      const userBefore = {
        ...mockUser,
        balance: 800,
        lockedBalance: 200,
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        withTransaction: jest.fn((callback) => callback()),
      };

      mockConnection.startSession.mockReturnValue(session);

      userModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userBefore),
        }),
      });

      userModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userBefore),
      });

      // Existing ledger entry found (already refunded)
      ledgerEntryModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'existing-entry',
            type: LedgerType.REFUND,
            amount: 200,
          }),
        }),
      });

      const result = await service.refund('user123', 200, 'auction123');

      // Should not create duplicate ledger entry
      expect(ledgerEntryModel.create).not.toHaveBeenCalled();
    });
  });

  describe('validateBalanceInvariants', () => {
    it('should return true when invariants are valid', async () => {
      const user = {
        ...mockUser,
        balance: 800,
        lockedBalance: 200,
      };

      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.validateBalanceInvariants('user123');
      expect(result).toBe(true);
    });

    it('should return false when balance is negative', async () => {
      const user = {
        ...mockUser,
        balance: -100, // Invalid!
        lockedBalance: 1100,
      };

      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.validateBalanceInvariants('user123');
      expect(result).toBe(false);
    });

    it('should return false when lockedBalance is negative', async () => {
      const user = {
        ...mockUser,
        balance: 1000,
        lockedBalance: -50, // Invalid!
      };

      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      });

      const result = await service.validateBalanceInvariants('user123');
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.validateBalanceInvariants('nonexistent');
      expect(result).toBe(false);
    });
  });
});


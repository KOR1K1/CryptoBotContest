import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../models/user.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
} from '../../models/ledger-entry.schema';
import { LedgerType } from '../../common/enums/ledger-type.enum';

/**
 * BalanceService
 *
 * Handles all balance operations with strict financial invariants:
 * - All operations are atomic (MongoDB transactions)
 * - Every operation creates a LedgerEntry (audit trail)
 * - Balance invariants are enforced: balance >= 0, lockedBalance >= 0
 *
 * This service is the ONLY place where User balances should be modified.
 */
@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(LedgerEntry.name)
    private ledgerEntryModel: Model<LedgerEntryDocument>,
  ) {}

  /**
   * Validate that user has sufficient balance
   * Does not modify balance, only checks
   *
   * @param userId User ID
   * @param amount Amount to validate
   * @returns true if user has sufficient balance
   * @throws NotFoundException if user not found
   */
  async validateBalance(userId: string, amount: number): Promise<boolean> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const hasSufficientBalance = user.balance >= amount;
    if (!hasSufficientBalance) {
      this.logger.warn(
        `Insufficient balance for user ${userId}: requested ${amount}, available ${user.balance}`,
      );
    }

    return hasSufficientBalance;
  }

  /**
   * Lock funds for a bid
   * Decreases balance, increases lockedBalance
   * Creates LOCK ledger entry
   *
   * @param userId User ID
   * @param amount Amount to lock
   * @param referenceId Reference ID (usually bidId)
   * @param description Optional description for ledger
   * @param session Optional MongoDB session (for nested transactions)
   * @returns Updated user document
   * @throws NotFoundException if user not found
   * @throws BadRequestException if insufficient balance
   */
  async lockFunds(
    userId: string,
    amount: number,
    referenceId: string,
    description?: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const useSession = session || (await this.connection.startSession());

    try {
      let result: UserDocument;

      // Execute transaction logic
      const executeTransaction = async () => {
        // Find user with lock (for concurrency safety)
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        // Validate sufficient balance
        if (user.balance < amount) {
          throw new BadRequestException(
            `Insufficient balance: requested ${amount}, available ${user.balance}`,
          );
        }

        // Update balance atomically
        const updatedUser = await this.userModel
          .findByIdAndUpdate(
            userId,
            {
              $inc: {
                balance: -amount,
                lockedBalance: +amount,
              },
            },
            { new: true, session: useSession },
          )
          .exec();

        if (!updatedUser) {
          throw new InternalServerErrorException('Failed to update user balance');
        }

        // Validate invariants after update
        if (updatedUser.balance < 0 || updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after lock operation',
          );
        }

        // Create ledger entry (idempotency: check if already exists)
        const existingLedgerEntry = await this.ledgerEntryModel
          .findOne({
            userId,
            type: LedgerType.LOCK,
            referenceId,
            amount,
          })
          .session(useSession)
          .exec();

        if (!existingLedgerEntry) {
          await this.ledgerEntryModel.create(
            [
              {
                userId,
                type: LedgerType.LOCK,
                amount,
                referenceId,
                description: description || `Lock funds for bid ${referenceId}`,
              },
            ],
            { session: useSession },
          );
        } else {
          this.logger.warn(
            `Ledger entry already exists for LOCK operation: userId=${userId}, referenceId=${referenceId}, amount=${amount}`,
          );
        }

        result = updatedUser;

        this.logger.log(
          `Locked ${amount} funds for user ${userId}, reference ${referenceId}`,
        );
      };

      // If session was provided, we're already in a transaction - execute directly
      // Otherwise, start a new transaction
      if (session) {
        await executeTransaction();
      } else {
        await useSession.withTransaction(executeTransaction);
      }

      // If we started the session, end it
      if (!session) {
        await useSession.endSession();
      }

      return result!;
    } catch (error) {
      if (!session) {
        await useSession.endSession();
      }

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Wrap unknown errors
      this.logger.error(`Error locking funds for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to lock funds: ${errorMessage}`);
    }
  }

  /**
   * Unlock funds (rare, for edge cases)
   * Increases balance, decreases lockedBalance
   * Creates UNLOCK ledger entry
   *
   * @param userId User ID
   * @param amount Amount to unlock
   * @param referenceId Reference ID (usually bidId)
   * @param description Optional description for ledger
   * @param session Optional MongoDB session
   * @returns Updated user document
   */
  async unlockFunds(
    userId: string,
    amount: number,
    referenceId: string,
    description?: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const useSession = session || (await this.connection.startSession());

    try {
      let result: UserDocument;

      // Execute transaction logic
      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        // Validate sufficient locked balance
        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

        // Update balance atomically
        const updatedUser = await this.userModel
          .findByIdAndUpdate(
            userId,
            {
              $inc: {
                balance: +amount,
                lockedBalance: -amount,
              },
            },
            { new: true, session: useSession },
          )
          .exec();

        if (!updatedUser) {
          throw new InternalServerErrorException('Failed to update user balance');
        }

        // Validate invariants
        if (updatedUser.balance < 0 || updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after unlock operation',
          );
        }

        // Create ledger entry (idempotency: check if already exists)
        const existingLedgerEntry = await this.ledgerEntryModel
          .findOne({
            userId,
            type: LedgerType.UNLOCK,
            referenceId,
            amount,
          })
          .session(useSession)
          .exec();

        if (!existingLedgerEntry) {
          await this.ledgerEntryModel.create(
            [
              {
                userId,
                type: LedgerType.UNLOCK,
                amount,
                referenceId,
                description: description || `Unlock funds for ${referenceId}`,
              },
            ],
            { session: useSession },
          );
        } else {
          this.logger.warn(
            `Ledger entry already exists for UNLOCK operation: userId=${userId}, referenceId=${referenceId}`,
          );
        }

        result = updatedUser;

        this.logger.log(
          `Unlocked ${amount} funds for user ${userId}, reference ${referenceId}`,
        );
      };

      // If session was provided, we're already in a transaction - execute directly
      // Otherwise, start a new transaction
      if (session) {
        await executeTransaction();
      } else {
        await useSession.withTransaction(executeTransaction);
      }

      if (!session) {
        await useSession.endSession();
      }

      return result!;
    } catch (error) {
      if (!session) {
        await useSession.endSession();
      }

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error unlocking funds for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to unlock funds: ${errorMessage}`);
    }
  }

  /**
   * Payout funds (winner pays for gift)
   * Decreases lockedBalance only (funds were already locked)
   * Creates PAYOUT ledger entry
   *
   * @param userId User ID
   * @param amount Amount to payout (deduct from locked balance)
   * @param referenceId Reference ID (auctionId or bidId)
   * @param description Optional description
   * @param session Optional MongoDB session
   * @returns Updated user document
   */
  async payout(
    userId: string,
    amount: number,
    referenceId: string,
    description?: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const useSession = session || (await this.connection.startSession());

    try {
      let result: UserDocument;

      // Execute transaction logic
      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        // Validate sufficient locked balance
        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance for payout: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

        // Decrease locked balance only (payment)
        const updatedUser = await this.userModel
          .findByIdAndUpdate(
            userId,
            {
              $inc: {
                lockedBalance: -amount,
              },
            },
            { new: true, session: useSession },
          )
          .exec();

        if (!updatedUser) {
          throw new InternalServerErrorException('Failed to update user balance');
        }

        // Validate invariants
        if (updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after payout operation',
          );
        }

        // Create ledger entry (idempotency: check if already exists for this bid/auction)
        // Note: Same bid can't be paid out twice due to bid status check, but double-check here
        const existingLedgerEntry = await this.ledgerEntryModel
          .findOne({
            userId,
            type: LedgerType.PAYOUT,
            referenceId,
            amount,
          })
          .session(useSession)
          .exec();

        if (!existingLedgerEntry) {
          await this.ledgerEntryModel.create(
            [
              {
                userId,
                type: LedgerType.PAYOUT,
                amount,
                referenceId,
                description:
                  description || `Payout for winning bid/auction ${referenceId}`,
              },
            ],
            { session: useSession },
          );
        } else {
          this.logger.warn(
            `Ledger entry already exists for PAYOUT operation: userId=${userId}, referenceId=${referenceId}`,
          );
          // This is idempotent - already processed, continue
        }

        result = updatedUser;

        this.logger.log(
          `Payout ${amount} from locked balance for user ${userId}, reference ${referenceId}`,
        );
      };

      // If session was provided, we're already in a transaction - execute directly
      // Otherwise, start a new transaction
      if (session) {
        await executeTransaction();
      } else {
        await useSession.withTransaction(executeTransaction);
      }

      if (!session) {
        await useSession.endSession();
      }

      return result!;
    } catch (error) {
      if (!session) {
        await useSession.endSession();
      }

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error processing payout for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to process payout: ${errorMessage}`);
    }
  }

  /**
   * Refund funds (non-winning bids after auction end)
   * Increases balance, decreases lockedBalance
   * Creates REFUND ledger entry
   *
   * @param userId User ID
   * @param amount Amount to refund
   * @param referenceId Reference ID (usually auctionId)
   * @param description Optional description
   * @param session Optional MongoDB session
   * @returns Updated user document
   */
  async refund(
    userId: string,
    amount: number,
    referenceId: string,
    description?: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const useSession = session || (await this.connection.startSession());

    try {
      let result: UserDocument;

      // Execute transaction logic
      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        // Validate sufficient locked balance
        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance for refund: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

        // Refund: increase balance, decrease locked balance
        const updatedUser = await this.userModel
          .findByIdAndUpdate(
            userId,
            {
              $inc: {
                balance: +amount,
                lockedBalance: -amount,
              },
            },
            { new: true, session: useSession },
          )
          .exec();

        if (!updatedUser) {
          throw new InternalServerErrorException('Failed to update user balance');
        }

        // Validate invariants
        if (updatedUser.balance < 0 || updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after refund operation',
          );
        }

        // Create ledger entry (idempotency: check if already exists for this bid)
        // Use bidId as referenceId for refunds to ensure one refund per bid
        const existingLedgerEntry = await this.ledgerEntryModel
          .findOne({
            userId,
            type: LedgerType.REFUND,
            referenceId, // For refunds, referenceId is usually bidId
            amount,
          })
          .session(useSession)
          .exec();

        if (!existingLedgerEntry) {
          await this.ledgerEntryModel.create(
            [
              {
                userId,
                type: LedgerType.REFUND,
                amount,
                referenceId,
                description:
                  description || `Refund for auction ${referenceId}`,
              },
            ],
            { session: useSession },
          );
        } else {
          this.logger.warn(
            `Ledger entry already exists for REFUND operation: userId=${userId}, referenceId=${referenceId}`,
          );
          // This is idempotent - already processed, continue
        }

        result = updatedUser;

        this.logger.log(
          `Refunded ${amount} to user ${userId} for auction ${referenceId}`,
        );
      };

      // If session was provided, we're already in a transaction - execute directly
      // Otherwise, start a new transaction
      if (session) {
        await executeTransaction();
      } else {
        await useSession.withTransaction(executeTransaction);
      }

      if (!session) {
        await useSession.endSession();
      }

      return result!;
    } catch (error) {
      if (!session) {
        await useSession.endSession();
      }

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error processing refund for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to process refund: ${errorMessage}`);
    }
  }

  /**
   * Deposit funds to user balance
   * Increases balance (for initial balance or external deposits)
   * Creates DEPOSIT ledger entry
   *
   * @param userId User ID
   * @param amount Amount to deposit
   * @param description Optional description for ledger
   * @param session Optional MongoDB session (for nested transactions)
   * @returns Updated user document
   * @throws NotFoundException if user not found
   * @throws BadRequestException if amount is invalid
   */
  async deposit(
    userId: string,
    amount: number,
    description?: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Deposit amount must be positive');
    }

    const useSession = session || (await this.connection.startSession());

    try {
      let result: UserDocument;

      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        // Update balance atomically
        const updatedUser = await this.userModel
          .findByIdAndUpdate(
            userId,
            {
              $inc: {
                balance: +amount,
              },
            },
            { new: true, session: useSession },
          )
          .exec();

        if (!updatedUser) {
          throw new InternalServerErrorException('Failed to update user balance');
        }

        // Validate invariants
        if (updatedUser.balance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after deposit operation',
          );
        }

        // Create ledger entry
        await this.ledgerEntryModel.create(
          [
            {
              userId,
              type: LedgerType.DEPOSIT,
              amount,
              referenceId: `deposit_${Date.now()}`,
              description: description || `Deposit ${amount}`,
            },
          ],
          { session: useSession },
        );

        result = updatedUser;

        this.logger.log(`Deposited ${amount} to user ${userId}`);
      };

      if (session) {
        await executeTransaction();
      } else {
        await useSession.withTransaction(executeTransaction);
      }

      if (!session) {
        await useSession.endSession();
      }

      return result!;
    } catch (error) {
      if (!session) {
        await useSession.endSession();
      }

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error processing deposit for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to process deposit: ${errorMessage}`);
    }
  }

  /**
   * Validate balance invariants for a user
   * Used for integrity checks
   *
   * @param userId User ID
   * @returns true if invariants are satisfied
   */
  async validateBalanceInvariants(userId: string): Promise<boolean> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return false;
    }

    const invariantsValid =
      user.balance >= 0 &&
      user.lockedBalance >= 0 &&
      !isNaN(user.balance) &&
      !isNaN(user.lockedBalance) &&
      isFinite(user.balance) &&
      isFinite(user.lockedBalance);

    if (!invariantsValid) {
      this.logger.error(
        `Balance invariants violated for user ${userId}: balance=${user.balance}, lockedBalance=${user.lockedBalance}`,
      );
    }

    return invariantsValid;
  }
}


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

// операции с балансом, все атомарно через транзакции
// каждая операция создает запись в ledger
// это единственное место где меняется баланс юзера
@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(LedgerEntry.name)
    private ledgerEntryModel: Model<LedgerEntryDocument>,
  ) {}

  // проверка достаточности баланса, не меняет баланс
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

  // блокировка средств для ставки
  // уменьшает balance, увеличивает lockedBalance
  // создает запись LOCK в ledger
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

      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        if (user.balance < amount) {
          throw new BadRequestException(
            `Insufficient balance: requested ${amount}, available ${user.balance}`,
          );
        }

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

        result = updatedUser;

        this.logger.log(
          `Locked ${amount} funds for user ${userId}, reference ${referenceId}`,
        );
      };

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

  // разблокировка средств (редко используется)
  // увеличивает balance, уменьшает lockedBalance
  // создает запись UNLOCK в ledger
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

      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

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

        if (updatedUser.balance < 0 || updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after unlock operation',
          );
        }

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

        result = updatedUser;

        this.logger.log(
          `Unlocked ${amount} funds for user ${userId}, reference ${referenceId}`,
        );
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

      this.logger.error(`Error unlocking funds for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to unlock funds: ${errorMessage}`);
    }
  }

  // выплата средств (победитель платит за подарок)
  // уменьшает только lockedBalance
  // создает запись PAYOUT в ledger
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

      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance for payout: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

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

        result = updatedUser;

        this.logger.log(
          `Payout ${amount} from locked balance for user ${userId}, reference ${referenceId}`,
        );
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

      this.logger.error(`Error processing payout for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to process payout: ${errorMessage}`);
    }
  }

  // возврат средств (невыигравшие ставки после завершения аукциона)
  // увеличивает balance, уменьшает lockedBalance
  // создает запись REFUND в ledger
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

      const executeTransaction = async () => {
        const user = await this.userModel
          .findById(userId)
          .session(useSession)
          .exec();

        if (!user) {
          throw new NotFoundException(`User with ID ${userId} not found`);
        }

        if (user.lockedBalance < amount) {
          throw new BadRequestException(
            `Insufficient locked balance for refund: requested ${amount}, locked ${user.lockedBalance}`,
          );
        }

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

        if (updatedUser.balance < 0 || updatedUser.lockedBalance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after refund operation',
          );
        }

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

        result = updatedUser;

        this.logger.log(
          `Refunded ${amount} to user ${userId} for auction ${referenceId}`,
        );
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

      this.logger.error(`Error processing refund for user ${userId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(`Failed to process refund: ${errorMessage}`);
    }
  }

  // пополнение баланса
  // увеличивает balance
  // создает запись DEPOSIT в ledger
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

        if (updatedUser.balance < 0) {
          throw new InternalServerErrorException(
            'Balance invariants violated after deposit operation',
          );
        }

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

  // проверка инвариантов баланса
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


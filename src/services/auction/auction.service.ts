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
import { Auction, AuctionDocument } from '../../models/auction.schema';
import {
  AuctionRound,
  AuctionRoundDocument,
} from '../../models/auction-round.schema';
import { Bid, BidDocument } from '../../models/bid.schema';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { BidService } from '../bid/bid.service';
import { BalanceService } from '../balance/balance.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';

export interface CreateAuctionDto {
  giftId: string;
  totalGifts: number;
  totalRounds: number;
  roundDurationMs: number;
  minBid: number;
  createdBy: string; // id пользователя который создал аукцион
}

export interface WinnerResult {
  bidId: string;
  userId: string;
  amount: number;
  roundIndex: number;
}

// основная логика аукционов
// не трогает балансы напрямую - через BalanceService
// не ставит ставки - через BidService
@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(AuctionRound.name)
    private auctionRoundModel: Model<AuctionRoundDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private bidService: BidService,
    private balanceService: BalanceService,
    private redisLockService: RedisLockService,
  ) {}

  // создание аукциона, статус CREATED, нужно отдельно запускать
  async createAuction(dto: CreateAuctionDto): Promise<AuctionDocument> {
    const { giftId, totalGifts, totalRounds, roundDurationMs, minBid, createdBy } = dto;

    if (totalGifts <= 0 || totalRounds <= 0) {
      throw new BadRequestException(
        'totalGifts and totalRounds must be positive',
      );
    }

    if (roundDurationMs < 1000) {
      throw new BadRequestException(
        'roundDurationMs must be at least 1000ms (1 second)',
      );
    }

    if (minBid <= 0) {
      throw new BadRequestException('minBid must be positive');
    }

    if (!createdBy) {
      throw new BadRequestException('createdBy is required');
    }

    const auction = await this.auctionModel.create({
      giftId,
      status: AuctionStatus.CREATED,
      totalGifts,
      totalRounds,
      currentRound: 0,
      roundDurationMs,
      minBid,
      createdBy,
    });

    this.logger.log(`Created auction ${auction._id} with ${totalRounds} rounds by user ${createdBy}`);

    return auction;
  }

  // запуск аукциона, создает первый раунд
  // только создатель может запустить
  async startAuction(auctionId: string, userId: string): Promise<AuctionDocument> {
    const session = await this.connection.startSession();

    try {
      let result: AuctionDocument;

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.createdBy.toString() !== userId) {
          throw new BadRequestException(
            'Only the creator of the auction can start it',
          );
        }

        if (auction.status !== AuctionStatus.CREATED) {
          throw new BadRequestException(
            `Auction must be in CREATED status to start. Current: ${auction.status}`,
          );
        }

        const giftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);
        const now = new Date();
        const roundEndsAt = new Date(now.getTime() + auction.roundDurationMs);

        await this.auctionRoundModel.create(
          [
            {
              auctionId: auction._id.toString(),
              roundIndex: 0,
              startedAt: now,
              endsAt: roundEndsAt,
              winnersCount: 0,
              closed: false,
            },
          ],
          { session },
        );

        const updatedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              status: AuctionStatus.RUNNING,
              startedAt: now,
              currentRound: 0,
            },
            { new: true, session },
          )
          .exec();

        if (!updatedAuction) {
          throw new InternalServerErrorException('Failed to start auction');
        }

        result = updatedAuction;

        this.logger.log(
          `Started auction ${auctionId}, round 0 ends at ${roundEndsAt.toISOString()}`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error starting auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to start auction: ${errorMessage}`,
      );
    }
  }

  // определяем победителей: сортировка по сумме DESC, потом по времени ASC
  // используем limit чтобы не грузить все ставки в память
  async calculateWinners(
    auctionId: string,
    currentRound: number,
    giftsPerRound: number,
    session?: ClientSession,
  ): Promise<BidDocument[]> {
    const winners = await this.bidModel
      .find({
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 })
      .limit(giftsPerRound)
      .session(session || null)
      .exec();

    if (winners.length === 0) {
      this.logger.warn(`No active bids found for auction ${auctionId}`);
      return [];
    }

    this.logger.log(
      `Calculated ${winners.length} winners for auction ${auctionId}, round ${currentRound} (out of top ${giftsPerRound} requested)`,
    );

    return winners;
  }

  // закрытие раунда: выбираем победителей, помечаем WON, выплачиваем
  // используем redis lock если доступен, иначе просто транзакции
  async closeCurrentRound(auctionId: string): Promise<{
    round: AuctionRoundDocument;
    winners: WinnerResult[];
  }> {
    const roundLockKey = `round:${auctionId}`;
    const useRedisLocks = this.redisLockService.isLockServiceAvailable();

    if (useRedisLocks) {
      return this.redisLockService.withLock(
        roundLockKey,
        async () => {
          return this.executeCloseRoundTransaction(auctionId);
        },
        60, // таймаут 60 сек, закрытие может долго идти если ставок много
        { maxRetries: 1, retryDelayMs: 500 },
      );
    } else {
      return this.executeCloseRoundTransaction(auctionId);
    }
  }

  // сама транзакция закрытия раунда
  private async executeCloseRoundTransaction(auctionId: string): Promise<{
    round: AuctionRoundDocument;
    winners: WinnerResult[];
  }> {
    const session = await this.connection.startSession();

    try {
      let result: {
        round: AuctionRoundDocument;
        winners: WinnerResult[];
      };

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status !== AuctionStatus.RUNNING) {
          throw new BadRequestException(
            `Auction must be RUNNING to close round. Current: ${auction.status}`,
          );
        }

        const currentRound = await this.auctionRoundModel
          .findOne({
            auctionId,
            roundIndex: auction.currentRound,
          })
          .session(session)
          .exec();

        if (!currentRound) {
          throw new NotFoundException(
            `Round ${auction.currentRound} not found for auction ${auctionId}`,
          );
        }

        if (currentRound.closed) {
          throw new BadRequestException(
            `Round ${auction.currentRound} is already closed`,
          );
        }

        const isLastRound = auction.currentRound === auction.totalRounds - 1;
        // раунды только для анти-снайпинга, всего подарков = totalGifts, никогда не больше
        const previousRounds = await this.auctionRoundModel
          .find({
            auctionId,
            roundIndex: { $lt: auction.currentRound },
            closed: true,
          })
          .session(session)
          .exec();

        const alreadyAwarded = previousRounds.reduce(
          (sum, r) => sum + r.winnersCount,
          0,
        );

        const remainingGifts = auction.totalGifts - alreadyAwarded;
        
        if (remainingGifts <= 0) {
          // все подарки уже вручены, закрываем раунд без победителей
          const updatedRound = await this.auctionRoundModel
            .findByIdAndUpdate(
              currentRound._id,
              {
                closed: true,
                winnersCount: 0,
                updatedAt: new Date(),
              },
              { new: true, session },
            )
            .exec();

          if (!updatedRound) {
            throw new InternalServerErrorException('Failed to close round');
          }

          // если все подарки уже вручены - аукцион нужно завершить
          // но не делаем это здесь, только закрываем раунд
          // scheduler сам проверит и завершит
          
          result = {
            round: updatedRound,
            winners: [],
          };
          return;
        }
        
        let giftsPerRound: number;
        if (isLastRound) {
          giftsPerRound = remainingGifts;
        } else {
          const baseGiftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);
          giftsPerRound = Math.min(baseGiftsPerRound, remainingGifts);
        }
        const winnerBids = await this.calculateWinners(
          auctionId,
          auction.currentRound,
          giftsPerRound,
          session,
        );

        const winners: WinnerResult[] = [];
        for (const bid of winnerBids) {
          // проверяем что ставка еще ACTIVE (идемпотентность)
          const currentBid = await this.bidModel
            .findById(bid._id)
            .session(session)
            .exec();

          if (!currentBid) {
            this.logger.warn(
              `Bid ${bid._id} not found - may have been deleted, skipping`,
            );
            continue;
          }

          if (currentBid.status !== BidStatus.ACTIVE) {
            this.logger.warn(
              `Bid ${bid._id} is already ${currentBid.status}, skipping payout (idempotency)`,
            );
            // уже обработана, добавляем в список но выплату пропускаем
            winners.push({
              bidId: bid._id.toString(),
              userId: bid.userId.toString(),
              amount: bid.amount,
              roundIndex: bid.roundIndex,
            });
            continue;
          }

          // помечаем ставку WON, записываем раунд выигрыша
          // roundIndex - где сделана ставка, wonInRoundIndex - где выиграла
          const updatedBid = await this.bidModel
            .findByIdAndUpdate(
              bid._id,
              {
                status: BidStatus.WON,
                wonInRoundIndex: auction.currentRound,
                updatedAt: new Date(),
              },
              { new: true, session },
            )
            .exec();

          if (!updatedBid) {
            throw new InternalServerErrorException(
              `Failed to update bid ${bid._id} to WON status`,
            );
          }

          // выплата - списываем с lockedBalance
          // bidId как referenceId для идемпотентности
          await this.balanceService.payout(
            bid.userId.toString(),
            bid.amount,
            bid._id.toString(),
            `Payout for winning bid in round ${auction.currentRound}`,
            session,
          );

          winners.push({
            bidId: bid._id.toString(),
            userId: bid.userId.toString(),
            amount: bid.amount,
            roundIndex: bid.roundIndex,
          });
        }

        const updatedRound = await this.auctionRoundModel
          .findByIdAndUpdate(
            currentRound._id,
            {
              closed: true,
              winnersCount: winners.length,
              updatedAt: new Date(),
            },
            { new: true, session },
          )
          .exec();

        if (!updatedRound) {
          throw new InternalServerErrorException('Failed to close round');
        }

        result = {
          round: updatedRound,
          winners,
        };

        this.logger.log(
          `Closed round ${auction.currentRound} for auction ${auctionId}, ${winners.length} winners`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error closing round for auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to close round: ${errorMessage}`,
      );
    }
  }

  // переход к следующему раунду
  // активные ставки (не выигравшие) переносятся автоматически
  async advanceRound(auctionId: string): Promise<{
    auction: AuctionDocument;
    round: AuctionRoundDocument;
  }> {
    const session = await this.connection.startSession();

    try {
      let result: {
        auction: AuctionDocument;
        round: AuctionRoundDocument;
      };

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status !== AuctionStatus.RUNNING) {
          throw new BadRequestException(
            `Auction must be RUNNING to advance round. Current: ${auction.status}`,
          );
        }

        const nextRoundIndex = auction.currentRound + 1;

        if (nextRoundIndex >= auction.totalRounds) {
          throw new BadRequestException(
            `Cannot advance: auction has only ${auction.totalRounds} rounds (0-based, current: ${auction.currentRound})`,
          );
        }

        // обновляем roundIndex у всех активных ставок (перенос в новый раунд)
        await this.bidModel
          .updateMany(
            {
              auctionId,
              status: BidStatus.ACTIVE,
            },
            {
              $set: {
                roundIndex: nextRoundIndex,
                updatedAt: new Date(),
              },
            },
            { session },
          )
          .exec();

        const now = new Date();
        const roundEndsAt = new Date(now.getTime() + auction.roundDurationMs);

        const newRound = await this.auctionRoundModel.create(
          [
            {
              auctionId: auction._id.toString(),
              roundIndex: nextRoundIndex,
              startedAt: now,
              endsAt: roundEndsAt,
              winnersCount: 0,
              closed: false,
            },
          ],
          { session },
        );

        if (!newRound || newRound.length === 0) {
          throw new InternalServerErrorException('Failed to create new round');
        }

        const updatedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              currentRound: nextRoundIndex,
            },
            { new: true, session },
          )
          .exec();

        if (!updatedAuction) {
          throw new InternalServerErrorException('Failed to update auction');
        }

        result = {
          auction: updatedAuction,
          round: newRound[0],
        };

        this.logger.log(
          `Advanced auction ${auctionId} to round ${nextRoundIndex}`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error advancing round for auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to advance round: ${errorMessage}`,
      );
    }
  }

  // завершение аукциона после последнего раунда
  // закрывает последний раунд если не закрыт, возвращает деньги за оставшиеся ставки
  async finalizeAuction(auctionId: string): Promise<AuctionDocument> {
    const session = await this.connection.startSession();

    try {
      let result: AuctionDocument;

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status === AuctionStatus.COMPLETED) {
          result = auction;
          return;
        }

        if (
          auction.status !== AuctionStatus.RUNNING &&
          auction.status !== AuctionStatus.FINALIZING
        ) {
          throw new BadRequestException(
            `Auction must be RUNNING or FINALIZING to finalize. Current: ${auction.status}`,
          );
        }

        const currentRound = await this.auctionRoundModel
          .findOne({
            auctionId,
            roundIndex: auction.currentRound,
          })
          .session(session)
          .exec();

        if (currentRound && !currentRound.closed) {
          const isLastRound = auction.currentRound === auction.totalRounds - 1;
          if (isLastRound) {
            const previousRounds = await this.auctionRoundModel
              .find({
                auctionId,
                roundIndex: { $lt: auction.currentRound },
                closed: true,
              })
              .session(session)
              .exec();

            const alreadyAwarded = previousRounds.reduce(
              (sum, r) => sum + r.winnersCount,
              0,
            );

            const giftsPerRound = Math.max(0, auction.totalGifts - alreadyAwarded);

            const winnerBids = await this.calculateWinners(
              auctionId,
              auction.currentRound,
              giftsPerRound,
              session,
            );

            for (const bid of winnerBids) {
              // проверяем что ставка еще ACTIVE (идемпотентность)
              const currentBid = await this.bidModel
                .findById(bid._id)
                .session(session)
                .exec();

              if (!currentBid || currentBid.status !== BidStatus.ACTIVE) {
                if (currentBid) {
                  this.logger.log(
                    `Bid ${bid._id} already ${currentBid.status}, skipping (idempotency)`,
                  );
                }
                continue;
              }

              await this.bidModel
                .findByIdAndUpdate(
                  bid._id,
                  {
                    status: BidStatus.WON,
                    wonInRoundIndex: auction.currentRound,
                    updatedAt: new Date(),
                  },
                  { new: true, session },
                )
                .exec();

              // выплата, bidId как referenceId для идемпотентности
              await this.balanceService.payout(
                bid.userId.toString(),
                bid.amount,
                bid._id.toString(),
                `Payout for winning bid in final round ${auction.currentRound}`,
                session,
              );
            }

            await this.auctionRoundModel
              .findByIdAndUpdate(
                currentRound._id,
                {
                  closed: true,
                  winnersCount: winnerBids.length,
                  updatedAt: new Date(),
                },
                { session },
              )
              .exec();
          }
        }

        // переводим в FINALIZING если еще не там
        if (auction.status === AuctionStatus.RUNNING) {
          await this.auctionModel
            .findByIdAndUpdate(
              auctionId,
              {
                status: AuctionStatus.FINALIZING,
              },
              { session },
            )
            .exec();
        }

        // обрабатываем возвраты батчами чтобы не грузить миллионы ставок в память
        const BATCH_SIZE = 1000;
        let refundedCount = 0;
        let hasMore = true;
        let lastBidId: string | null = null;

        while (hasMore) {
          const query: any = {
            auctionId,
            status: BidStatus.ACTIVE,
          };
          
          // курсорная пагинация для батчей
          if (lastBidId) {
            query._id = { $gt: lastBidId };
          }

          const activeBidsBatch = await this.bidModel
            .find(query)
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .session(session)
            .exec();

          if (activeBidsBatch.length === 0) {
            hasMore = false;
            break;
          }

          for (const bid of activeBidsBatch) {
            // проверяем что ставка еще ACTIVE (может быть обработана другим инстансом)
            const currentBid = await this.bidModel
              .findOne({
                _id: bid._id,
                auctionId,
                status: BidStatus.ACTIVE,
              })
              .session(session)
              .exec();

            if (!currentBid) {
              // уже обработана или удалена, пропускаем
              this.logger.debug(`Bid ${bid._id} not found or already processed, skipping refund`);
              continue;
            }

            // помечаем REFUNDED атомарно чтобы не обработать дважды
            const updatedBid = await this.bidModel
              .findByIdAndUpdate(
                bid._id,
                {
                  status: BidStatus.REFUNDED,
                  updatedAt: new Date(),
                },
                { new: true, session },
              )
              .exec();

            if (!updatedBid) {
              // другой процесс мог обновить, пропускаем
              this.logger.debug(`Bid ${bid._id} update failed (may be processed already), skipping refund`);
              continue;
            }

            // возврат, bidId как referenceId - один возврат на ставку
            await this.balanceService.refund(
              bid.userId.toString(),
              bid.amount,
              bid._id.toString(),
              `Refund for non-winning bid after auction completion`,
              session,
            );

            refundedCount++;
            lastBidId = bid._id.toString();
          }

          if (activeBidsBatch.length < BATCH_SIZE) {
            hasMore = false;
          }

          // логируем прогресс для больших возвратов
          if (refundedCount % 10000 === 0) {
            this.logger.log(
              `Processed ${refundedCount} refunds for auction ${auctionId} (batch processing)`,
            );
          }
        }

        this.logger.log(
          `Completed refund processing for auction ${auctionId}: ${refundedCount} bids refunded`,
        );

        const finalizedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              status: AuctionStatus.COMPLETED,
              endsAt: new Date(),
            },
            { new: true, session },
          )
          .exec();

        if (!finalizedAuction) {
          throw new InternalServerErrorException('Failed to finalize auction');
        }

        result = finalizedAuction;

        this.logger.log(
          `Finalized auction ${auctionId}, refunded ${refundedCount} bids`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error finalizing auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to finalize auction: ${errorMessage}`,
      );
    }
  }

  async getAllAuctions(): Promise<AuctionDocument[]> {
    return this.auctionModel.find().sort({ createdAt: -1 }).exec();
  }

  async getAuctionById(auctionId: string): Promise<AuctionDocument> {
    const auction = await this.auctionModel.findById(auctionId).exec();
    if (!auction) {
      throw new NotFoundException(`Auction ${auctionId} not found`);
    }
    return auction;
  }

  async getCurrentRound(
    auctionId: string,
  ): Promise<AuctionRoundDocument | null> {
    const auction = await this.getAuctionById(auctionId);
    
    let round = await this.auctionRoundModel
      .findOne({
        auctionId,
        roundIndex: auction.currentRound,
      })
      .exec();

    // для завершенных аукционов берем последний закрытый раунд
    if (!round && auction.status === AuctionStatus.COMPLETED) {
      round = await this.auctionRoundModel
        .findOne({
          auctionId,
          closed: true,
        })
        .sort({ roundIndex: -1 })
        .exec();
    }

    return round;
  }

  async getAuctionRounds(auctionId: string): Promise<AuctionRoundDocument[]> {
    return this.auctionRoundModel
      .find({ auctionId })
      .sort({ roundIndex: 1 })
      .exec();
  }

  // считаем подарки для отображения (без транзакции)
  async calculateGiftsPerRoundForDisplay(
    auctionId: string,
  ): Promise<{ giftsPerRound: number; remainingGifts: number; alreadyAwarded: number }> {
    const auction = await this.getAuctionById(auctionId);
    const isLastRound = auction.currentRound === auction.totalRounds - 1;
    const isCompleted = auction.status === AuctionStatus.COMPLETED;

    const query: any = {
      auctionId,
      closed: true,
    };

    if (isCompleted) {
      // для завершенных считаем все закрытые раунды
    } else {
      query.roundIndex = { $lt: auction.currentRound };
    }

    const closedRounds = await this.auctionRoundModel.find(query).exec();

    const alreadyAwarded = closedRounds.reduce(
      (sum, r) => sum + (r.winnersCount || 0),
      0,
    );

    const remainingGifts = auction.totalGifts - alreadyAwarded;

    let giftsPerRound: number;
    if (isCompleted) {
      giftsPerRound = 0;
    } else if (isLastRound) {
      giftsPerRound = Math.max(0, remainingGifts);
    } else {
      const baseGiftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);
      giftsPerRound = Math.min(baseGiftsPerRound, Math.max(0, remainingGifts));
    }

    return {
      giftsPerRound,
      remainingGifts: Math.max(0, remainingGifts),
      alreadyAwarded,
    };
  }
}


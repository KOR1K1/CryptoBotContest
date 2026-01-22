import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, forwardRef, Injectable, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BidUpdateThrottlerService } from '../services/throttler/bid-update-throttler.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../models/user.schema';
import { AuthService } from '../auth/auth.service';

/**
 * AuctionsGateway
 * 
 * WebSocket gateway for real-time auction updates
 * Emits events when:
 * - New bids are placed (throttled via BidUpdateThrottlerService)
 * - Auction status changes
 * - Rounds close
 * - Winners are selected
 * 
 * Authentication:
 * - Primary: JWT token from handshake.auth.token or query.token
 * - Fallback: userId query parameter (for development/testing)
 * - Token is validated and userId is extracted from JWT payload
 */
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman)
      if (!origin) {
        return callback(null, true);
      }
      // Get allowed origins from config (same as REST API)
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
        'http://localhost:3001',
        'http://localhost:3000',
      ];
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  namespace: '/auctions',
})
@Injectable()
export class AuctionsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AuctionsGateway.name);
  private readonly requireAuth: boolean;

  constructor(
    @Inject(forwardRef(() => BidUpdateThrottlerService))
    private readonly bidUpdateThrottler: BidUpdateThrottlerService | null,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
    private jwtService: JwtService,
    private authService: AuthService,
  ) {
    // In production, require authentication; in development, make it optional
    this.requireAuth = this.configService.get<string>('nodeEnv', 'development') === 'production';
  }

  afterInit(server: Server) {
    this.logger.log('Auctions WebSocket Gateway initialized');
    // Set up authentication middleware
    server.use(async (socket: Socket, next) => {
      try {
        let user: UserDocument | null = null;
        let userId: string | null = null;

        // Try to extract JWT token from handshake
        // Socket.IO clients can send token in:
        // 1. handshake.auth.token (recommended)
        // 2. query.token (fallback)
        const token = 
          (socket.handshake.auth?.token as string) || 
          (socket.handshake.query?.token as string) ||
          null;

        // If token is provided, validate it
        if (token) {
          try {
            // Verify and decode JWT token
            const payload = await this.jwtService.verifyAsync(token, {
              secret: this.configService.get<string>('jwt.secret', 'default-secret-key'),
            });

            // Extract userId from token payload
            userId = payload.sub;

            // Validate user exists (userId is guaranteed to be string from JWT payload)
            if (userId) {
              user = await this.authService.validateUser(userId);
            }
            
            this.logger.log(`WebSocket authenticated via JWT: userId=${userId}, client=${socket.id}`);
          } catch (tokenError) {
            // Token is invalid or expired
            if (this.requireAuth) {
              this.logger.warn(`WebSocket connection rejected: invalid JWT token (client: ${socket.id})`);
              return next(new Error('Authentication failed: invalid or expired token'));
            } else {
              // In development, log warning but continue (allow connection without auth)
              this.logger.debug(`WebSocket JWT token invalid (development mode): ${tokenError instanceof Error ? tokenError.message : String(tokenError)}`);
              // Don't set user/userId if token is invalid, but allow connection
            }
          }
        }

        // Fallback: Try userId from query parameter (for development/testing)
        if (!user && !userId) {
          const queryUserId = socket.handshake.query.userId as string | undefined;
          
          if (queryUserId) {
            const queryUser = await this.userModel.findById(queryUserId).exec();
            if (queryUser) {
              user = queryUser;
              userId = queryUserId;
              this.logger.log(`WebSocket authenticated via query userId (fallback): userId=${userId}, client=${socket.id}`);
            } else {
              if (this.requireAuth) {
                this.logger.warn(`WebSocket connection rejected: invalid userId ${queryUserId} (client: ${socket.id})`);
                return next(new Error('Authentication failed: invalid userId'));
              }
            }
          }
        }

        // In production, require authentication
        if (this.requireAuth && !user) {
          this.logger.warn(`WebSocket connection rejected: authentication required (client: ${socket.id})`);
          return next(new Error('Authentication required: JWT token or userId query parameter missing'));
        }

        // Attach user to socket for later use
        if (user && userId) {
          (socket as any).userId = userId;
          (socket as any).user = user;
        } else {
          this.logger.log(`WebSocket connected without authentication (development mode): client=${socket.id}`);
        }

        next();
      } catch (error) {
        this.logger.error(`WebSocket authentication error: ${error instanceof Error ? error.message : String(error)}`);
        next(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  handleConnection(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      this.logger.log(`Client connected (authenticated): ${client.id}, userId=${userId}`);
    } else {
      this.logger.log(`Client connected (anonymous): ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      this.logger.log(`Client disconnected (authenticated): ${client.id}, userId=${userId}`);
    } else {
      this.logger.log(`Client disconnected (anonymous): ${client.id}`);
    }
  }

  /**
   * Subscribe to auction updates
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { auctionId: string }) {
    if (payload?.auctionId) {
      client.join(`auction:${payload.auctionId}`);
      this.logger.log(`Client ${client.id} subscribed to auction ${payload.auctionId}`);
    }
  }

  /**
   * Unsubscribe from auction updates
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, payload: { auctionId: string }) {
    if (payload?.auctionId) {
      client.leave(`auction:${payload.auctionId}`);
      this.logger.log(`Client ${client.id} unsubscribed from auction ${payload.auctionId}`);
    }
  }

  /**
   * Emit bid update to all subscribers of an auction (THROTTLED)
   * Uses BidUpdateThrottlerService to batch updates and emit only significant changes
   * 
   * @param auctionId Auction ID
   * @param bid Bid update data
   */
  emitBidUpdate(auctionId: string, bid: any) {
    // Use throttler if available, otherwise emit immediately (fallback)
    if (this.bidUpdateThrottler) {
      this.bidUpdateThrottler.queueBidUpdate(auctionId, bid);
      this.logger.debug(`Queued bid_update for auction ${auctionId} (throttled)`);
    } else {
      // Fallback: emit immediately if throttler not available
      this.server.to(`auction:${auctionId}`).emit('bid_update', {
        auctionId,
        bid,
        timestamp: new Date().toISOString(),
      });
      this.logger.debug(`Emitted bid_update for auction ${auctionId} (immediate, no throttler)`);
    }
  }

  /**
   * Emit bid update immediately (bypass throttler)
   * Used for critical updates that must be sent immediately
   * 
   * @param auctionId Auction ID
   * @param data Update data (can be single bid or aggregated update)
   */
  emitBidUpdateImmediate(auctionId: string, data: any) {
    this.server.to(`auction:${auctionId}`).emit('bid_update', {
      auctionId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.debug(`Emitted bid_update immediately for auction ${auctionId}`);
  }

  /**
   * Emit auction status update
   */
  emitAuctionUpdate(auctionId: string, auction: any) {
    const room = `auction:${auctionId}`;
    const eventData = {
      auctionId,
      auction,
      timestamp: new Date().toISOString(),
    };
    
    // Emit to room (subscribed clients)
    this.server.to(room).emit('auction_update', eventData);
    
    // Also emit globally for list updates (important for completed auctions)
    this.server.emit('auction_update', eventData);
    
    this.logger.log(`Emitted auction_update for auction ${auctionId}, status: ${auction?.status || 'unknown'}`);
  }

  /**
   * Emit round closed event
   */
  emitRoundClosed(auctionId: string, round: any, winners: any[]) {
    this.server.to(`auction:${auctionId}`).emit('round_closed', {
      auctionId,
      round,
      winners,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Emitted round_closed for auction ${auctionId}, round ${round.roundIndex}`);
  }

  /**
   * Emit global auction list update
   */
  emitAuctionsListUpdate() {
    this.server.emit('auctions_list_update', {
      timestamp: new Date().toISOString(),
    });
    this.logger.debug('Emitted auctions_list_update');
  }
}

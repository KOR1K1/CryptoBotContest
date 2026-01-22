import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, connect } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../models/user.schema';
import { Gift, GiftDocument } from '../models/gift.schema';
import { Auction, AuctionDocument } from '../models/auction.schema';
import { Bid, BidDocument } from '../models/bid.schema';
import { LedgerEntry, LedgerEntryDocument } from '../models/ledger-entry.schema';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../services/balance/balance.module';
import { ModelsModule } from '../models/models.module';
import { AuctionStatus } from '../common/enums/auction-status.enum';

/**
 * Integration Tests: Authentication API
 *
 * Tests authentication endpoints:
 * 1. POST /auth/register - User registration
 * 2. POST /auth/login - User login
 * 3. GET /auth/me - Get current user (protected)
 * 4. Protected endpoints with JWT token
 * 5. Error cases (invalid credentials, missing token, etc.)
 */
describe('Authentication Integration Tests', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryReplSet;
  let connection: Connection;

  let userModel: Model<UserDocument>;
  let giftModel: Model<GiftDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;
  let ledgerEntryModel: Model<LedgerEntryDocument>;

  beforeAll(async () => {
    // Start in-memory MongoDB with replica set (required for transactions)
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const mongoUri = mongoServer.getUri();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.test', '.env'],
        }),
        MongooseModule.forRoot(mongoUri, {
          retryWrites: true,
          retryReads: true,
        }),
        AppModule,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    connection = module.get<Connection>(getConnectionToken());
    userModel = module.get<Model<UserDocument>>(getModelToken(User.name));
    giftModel = module.get<Model<GiftDocument>>(getModelToken(Gift.name));
    auctionModel = module.get<Model<AuctionDocument>>(getModelToken(Auction.name));
    bidModel = module.get<Model<BidDocument>>(getModelToken(Bid.name));
    ledgerEntryModel = module.get<Model<LedgerEntryDocument>>(
      getModelToken(LedgerEntry.name),
    );
  });

  afterAll(async () => {
    await connection.close();
    await mongoServer.stop();
    await app.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await userModel.deleteMany({});
    await giftModel.deleteMany({});
    await auctionModel.deleteMany({});
    await bidModel.deleteMany({});
    await ledgerEntryModel.deleteMany({});
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const registerDto = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('username', 'testuser');
      expect(response.body.user).toHaveProperty('email', 'test@example.com');
      expect(response.body.user).toHaveProperty('balance', 0);
      expect(response.body.user).toHaveProperty('lockedBalance', 0);

      // Verify user was created in database
      const user = await userModel.findOne({ username: 'testuser' }).exec();
      expect(user).toBeDefined();
      expect(user?.username).toBe('testuser');
      expect(user?.email).toBe('test@example.com');
      expect(user?.password).toBeDefined(); // Password should be hashed
      expect(user?.password).not.toBe('password123'); // Should not be plain text
    });

    it('should register user without email', async () => {
      const registerDto = {
        username: 'testuser2',
        password: 'password123',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body.user.email).toBeUndefined();
    });

    it('should register user with initial balance', async () => {
      const registerDto = {
        username: 'testuser3',
        password: 'password123',
        initialBalance: 5000,
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body.user.balance).toBe(5000);

      // Verify balance was deposited
      const user = await userModel.findById(response.body.user.id).exec();
      expect(user?.balance).toBe(5000);
    });

    it('should return 409 if username already exists', async () => {
      // Create user first
      await userModel.create({
        username: 'existinguser',
        password: 'hashedpassword',
        balance: 0,
        lockedBalance: 0,
      });

      const registerDto = {
        username: 'existinguser',
        password: 'password123',
      };

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(409);
    });

    it('should validate required fields', async () => {
      const registerDto = {
        // Missing username and password
        email: 'test@example.com',
      };

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Create a test user
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);

      await userModel.create({
        username: 'testuser',
        password: hashedPassword,
        email: 'test@example.com',
        balance: 1000,
        lockedBalance: 0,
      });
    });

    it('should login user with valid credentials', async () => {
      const loginDto = {
        username: 'testuser',
        password: 'password123',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('username', 'testuser');
      expect(response.body.user).toHaveProperty('balance', 1000);
    });

    it('should return 401 if username is invalid', async () => {
      const loginDto = {
        username: 'nonexistent',
        password: 'password123',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(401);
    });

    it('should return 401 if password is invalid', async () => {
      const loginDto = {
        username: 'testuser',
        password: 'wrongpassword',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(401);
    });

    it('should validate required fields', async () => {
      const loginDto = {
        // Missing password
        username: 'testuser',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send(loginDto)
        .expect(400);
    });
  });

  describe('GET /auth/me', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Register and login to get token
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: 'test@example.com',
        });

      authToken = registerResponse.body.access_token;
      userId = registerResponse.body.user.id;
    });

    it('should return current user with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', userId);
      expect(response.body).toHaveProperty('username', 'testuser');
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).toHaveProperty('balance');
      expect(response.body).toHaveProperty('lockedBalance');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should return 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should return 401 with malformed token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not.a.valid.jwt')
        .expect(401);
    });
  });

  describe('Protected endpoints with JWT', () => {
    let authToken: string;
    let userId: string;
    let giftId: string;

    beforeEach(async () => {
      // Register and login to get token
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      authToken = registerResponse.body.access_token;
      userId = registerResponse.body.user.id;

      // Create a gift for auction creation
      const gift = await giftModel.create({
        title: 'Test Gift',
        description: 'Test Description',
        basePrice: 100,
        totalSupply: 10,
      });
      giftId = gift._id.toString();
    });

    it('should allow creating auction with valid token', async () => {
      const createAuctionDto = {
        giftId,
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
      };

      const response = await request(app.getHttpServer())
        .post('/auctions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createAuctionDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status', AuctionStatus.CREATED);
    });

    it('should return 401 when creating auction without token', async () => {
      const createAuctionDto = {
        giftId,
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
      };

      await request(app.getHttpServer())
        .post('/auctions')
        .send(createAuctionDto)
        .expect(401);
    });

    it('should allow placing bid with valid token', async () => {
      // Create and start auction
      const auction = await auctionModel.create({
        giftId,
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
        status: AuctionStatus.RUNNING,
        currentRound: 0,
        createdBy: userId,
        startedAt: new Date(),
      });

      // Deposit balance for user
      await userModel.findByIdAndUpdate(userId, { balance: 1000 });

      const placeBidDto = {
        amount: 200,
      };

      const response = await request(app.getHttpServer())
        .post(`/auctions/${auction._id}/bids`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(placeBidDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('amount', 200);
    });

    it('should return 401 when placing bid without token', async () => {
      const auction = await auctionModel.create({
        giftId,
        totalGifts: 10,
        totalRounds: 3,
        roundDurationMs: 60000,
        minBid: 100,
        status: AuctionStatus.RUNNING,
        currentRound: 0,
        createdBy: userId,
        startedAt: new Date(),
      });

      const placeBidDto = {
        amount: 200,
      };

      await request(app.getHttpServer())
        .post(`/auctions/${auction._id}/bids`)
        .send(placeBidDto)
        .expect(401);
    });
  });
});

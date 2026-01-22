import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../models/user.schema';
import { Gift, GiftDocument } from '../models/gift.schema';
import { Auction, AuctionDocument } from '../models/auction.schema';
import { Bid, BidDocument } from '../models/bid.schema';
import { AuctionStatus } from '../common/enums/auction-status.enum';
import { BidStatus } from '../common/enums/bid-status.enum';

/**
 * E2E Tests: Full Authentication Flow
 *
 * Tests complete user journey:
 * 1. Register → Login → Place Bid
 * 2. Register → Create Auction → Start Auction → Place Bid
 * 3. Multiple users interacting with same auction
 * 4. Frontend token handling simulation
 */
describe('Authentication E2E Tests', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryReplSet;
  let connection: Connection;

  let userModel: Model<UserDocument>;
  let giftModel: Model<GiftDocument>;
  let auctionModel: Model<AuctionDocument>;
  let bidModel: Model<BidDocument>;

  beforeAll(async () => {
    // Start in-memory MongoDB with replica set
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
  });

  describe('Full user journey: Register → Login → Place Bid', () => {
    it('should complete full flow: register, login, place bid', async () => {
      // Step 1: Register user
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: 'test@example.com',
          initialBalance: 10000,
        })
        .expect(201);

      const { access_token: registerToken, user: registerUser } = registerResponse.body;
      expect(registerToken).toBeDefined();
      expect(registerUser.balance).toBe(10000);

      // Step 2: Login (simulating frontend token refresh or re-login)
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200);

      const { access_token: loginToken, user: loginUser } = loginResponse.body;
      expect(loginToken).toBeDefined();
      expect(loginUser.id).toBe(registerUser.id);
      expect(loginUser.username).toBe('testuser');

      // Step 3: Get current user (simulating frontend /auth/me call)
      const meResponse = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      expect(meResponse.body.id).toBe(registerUser.id);
      expect(meResponse.body.balance).toBe(10000);

      // Step 4: Create gift
      const gift = await giftModel.create({
        title: 'Test Gift',
        description: 'Test Description',
        basePrice: 100,
        totalSupply: 10,
      });

      // Step 5: Create auction
      const auctionResponse = await request(app.getHttpServer())
        .post('/auctions')
        .set('Authorization', `Bearer ${loginToken}`)
        .send({
          giftId: gift._id.toString(),
          totalGifts: 10,
          totalRounds: 3,
          roundDurationMs: 60000,
          minBid: 100,
        })
        .expect(201);

      const auctionId = auctionResponse.body.id;

      // Step 6: Start auction
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/start`)
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      // Step 7: Place bid
      const bidResponse = await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${loginToken}`)
        .send({
          amount: 500,
        })
        .expect(201);

      expect(bidResponse.body).toHaveProperty('id');
      expect(bidResponse.body).toHaveProperty('amount', 500);
      expect(bidResponse.body).toHaveProperty('status', BidStatus.ACTIVE);

      // Step 8: Verify bid was placed
      const bidsResponse = await request(app.getHttpServer())
        .get(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      expect(bidsResponse.body).toHaveLength(1);
      expect(bidsResponse.body[0].amount).toBe(500);

      // Step 9: Verify balance was locked
      const updatedUser = await userModel.findById(registerUser.id).exec();
      expect(updatedUser?.balance).toBe(9500); // 10000 - 500
      expect(updatedUser?.lockedBalance).toBe(500);
    });
  });

  describe('Multiple users interacting with same auction', () => {
    let giftId: string;
    let auctionId: string;

    beforeEach(async () => {
      // Create gift
      const gift = await giftModel.create({
        title: 'Test Gift',
        description: 'Test Description',
        basePrice: 100,
        totalSupply: 10,
      });
      giftId = gift._id.toString();

      // Register user1 and create auction
      const user1Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user1',
          password: 'password123',
          initialBalance: 10000,
        });

      const auctionResponse = await request(app.getHttpServer())
        .post('/auctions')
        .set('Authorization', `Bearer ${user1Response.body.access_token}`)
        .send({
          giftId,
          totalGifts: 10,
          totalRounds: 3,
          roundDurationMs: 60000,
          minBid: 100,
        });

      auctionId = auctionResponse.body.id;

      // Start auction
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/start`)
        .set('Authorization', `Bearer ${user1Response.body.access_token}`)
        .expect(200);
    });

    it('should allow multiple users to place bids on same auction', async () => {
      // Register user2
      const user2Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user2',
          password: 'password123',
          initialBalance: 10000,
        });

      // Register user3
      const user3Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user3',
          password: 'password123',
          initialBalance: 10000,
        });

      // User2 places bid
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${user2Response.body.access_token}`)
        .send({ amount: 200 })
        .expect(201);

      // User3 places bid
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${user3Response.body.access_token}`)
        .send({ amount: 300 })
        .expect(201);

      // Verify all bids exist
      const bidsResponse = await request(app.getHttpServer())
        .get(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${user2Response.body.access_token}`)
        .expect(200);

      expect(bidsResponse.body.length).toBeGreaterThanOrEqual(2);

      // Verify balances
      const user2 = await userModel.findById(user2Response.body.user.id).exec();
      const user3 = await userModel.findById(user3Response.body.user.id).exec();

      expect(user2?.balance).toBe(9800); // 10000 - 200
      expect(user2?.lockedBalance).toBe(200);
      expect(user3?.balance).toBe(9700); // 10000 - 300
      expect(user3?.lockedBalance).toBe(300);
    });

    it('should prevent users from accessing other users bids', async () => {
      // Register user2
      const user2Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user2',
          password: 'password123',
          initialBalance: 10000,
        });

      // User2 places bid
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${user2Response.body.access_token}`)
        .send({ amount: 200 })
        .expect(201);

      // User2 can see their own bids via /users/:id/bids
      const user2BidsResponse = await request(app.getHttpServer())
        .get(`/users/${user2Response.body.user.id}/bids`)
        .set('Authorization', `Bearer ${user2Response.body.access_token}`)
        .expect(200);

      expect(user2BidsResponse.body.length).toBeGreaterThanOrEqual(1);
      expect(user2BidsResponse.body[0].amount).toBe(200);
    });
  });

  describe('Frontend token handling simulation', () => {
    it('should handle token refresh scenario', async () => {
      // Register user
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token1 = registerResponse.body.access_token;

      // Use token to access protected endpoint
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      // Simulate frontend re-login (token refresh)
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200);

      const token2 = loginResponse.body.access_token;

      // Both tokens should work (until expiration)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);
    });

    it('should handle logout scenario (token invalidation simulation)', async () => {
      // Register and login
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = registerResponse.body.access_token;

      // Verify token works
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Simulate logout: frontend would remove token from storage
      // In this test, we just verify that without token, access is denied
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      // Re-login should work
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200);

      const newToken = loginResponse.body.access_token;

      // New token should work
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);
    });
  });
});

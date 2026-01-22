import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../models/user.schema';
import { Gift, GiftDocument } from '../models/gift.schema';
import { Auction, AuctionDocument } from '../models/auction.schema';
import { AuctionStatus } from '../common/enums/auction-status.enum';

/**
 * Security Tests: Authentication
 *
 * Tests security aspects of authentication:
 * 1. Access to another user's account (should be blocked)
 * 2. Invalid token usage
 * 3. Expired token usage
 * 4. Token tampering
 * 5. Authorization checks
 */
describe('Authentication Security Tests', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryReplSet;
  let connection: Connection;
  let jwtService: JwtService;

  let userModel: Model<UserDocument>;
  let giftModel: Model<GiftDocument>;
  let auctionModel: Model<AuctionDocument>;

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
    jwtService = module.get<JwtService>(JwtService);
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
  });

  describe('Access to another user account', () => {
    let user1Token: string;
    let user1Id: string;
    let user2Id: string;

    beforeEach(async () => {
      // Create user1
      const user1Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user1',
          password: 'password123',
        });
      user1Token = user1Response.body.access_token;
      user1Id = user1Response.body.user.id;

      // Create user2
      const user2Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user2',
          password: 'password123',
        });
      user2Id = user2Response.body.user.id;
    });

    it('should prevent accessing another user profile via /users/:id', async () => {
      // Try to access user2's profile with user1's token
      await request(app.getHttpServer())
        .get(`/users/${user2Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403); // Forbidden - should not allow access to another user's data
    });

    it('should allow accessing own profile via /users/:id', async () => {
      // Access own profile
      const response = await request(app.getHttpServer())
        .get(`/users/${user1Id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', user1Id);
      expect(response.body).toHaveProperty('username', 'user1');
    });

    it('should prevent accessing another user balance via /users/:id/balance', async () => {
      // Try to access user2's balance with user1's token
      await request(app.getHttpServer())
        .get(`/users/${user2Id}/balance`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403); // Forbidden
    });

    it('should allow accessing own balance via /users/:id/balance', async () => {
      // Access own balance
      const response = await request(app.getHttpServer())
        .get(`/users/${user1Id}/balance`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body).toHaveProperty('balance');
      expect(response.body).toHaveProperty('lockedBalance');
    });
  });

  describe('Invalid token usage', () => {
    it('should reject token with wrong signature', async () => {
      // Create a token with wrong secret
      const wrongToken = jwtService.sign(
        { sub: 'user123', username: 'testuser' },
        { secret: 'wrong-secret' },
      );

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(401);
    });

    it('should reject malformed token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not.a.valid.jwt.token')
        .expect(401);
    });

    it('should reject token without Bearer prefix', async () => {
      const token = jwtService.sign({ sub: 'user123', username: 'testuser' });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', token) // Missing 'Bearer ' prefix
        .expect(401);
    });

    it('should reject empty token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer ')
        .expect(401);
    });

    it('should reject token with missing sub field', async () => {
      const token = jwtService.sign({ username: 'testuser' }); // Missing 'sub'

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('Expired token usage', () => {
    it('should reject expired token', async () => {
      // Create a token that expires immediately
      const expiredToken = jwtService.sign(
        { sub: 'user123', username: 'testuser' },
        { expiresIn: '0s' }, // Expires immediately
      );

      // Wait a bit to ensure token is expired
      await new Promise((resolve) => setTimeout(resolve, 100));

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should accept valid non-expired token', async () => {
      // Register user first
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = registerResponse.body.access_token;

      // Use token immediately (should be valid)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('Token tampering', () => {
    it('should reject tampered token payload', async () => {
      // Create valid token
      const validToken = jwtService.sign({ sub: 'user123', username: 'testuser' });

      // Tamper with token (modify payload)
      const parts = validToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      payload.sub = 'different-user-id'; // Change user ID
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401); // Should reject due to signature mismatch
    });
  });

  describe('Authorization checks', () => {
    let user1Token: string;
    let user1Id: string;
    let user2Token: string;
    let user2Id: string;
    let giftId: string;
    let auctionId: string;

    beforeEach(async () => {
      // Create user1
      const user1Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user1',
          password: 'password123',
        });
      user1Token = user1Response.body.access_token;
      user1Id = user1Response.body.user.id;

      // Create user2
      const user2Response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user2',
          password: 'password123',
        });
      user2Token = user2Response.body.access_token;
      user2Id = user2Response.body.user.id;

      // Create gift
      const gift = await giftModel.create({
        title: 'Test Gift',
        description: 'Test Description',
        basePrice: 100,
        totalSupply: 10,
      });
      giftId = gift._id.toString();

      // Create auction by user1
      const auctionResponse = await request(app.getHttpServer())
        .post('/auctions')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          giftId,
          totalGifts: 10,
          totalRounds: 3,
          roundDurationMs: 60000,
          minBid: 100,
        });
      auctionId = auctionResponse.body.id;
    });

    it('should prevent user2 from starting auction created by user1', async () => {
      // Try to start auction with user2's token (but auction was created by user1)
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/start`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(400); // Bad Request - only creator can start
    });

    it('should allow user1 to start auction they created', async () => {
      // Start auction with user1's token (creator)
      await request(app.getHttpServer())
        .post(`/auctions/${auctionId}/start`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
    });

    it('should prevent unauthorized access to protected endpoints', async () => {
      // Try to create auction without token
      await request(app.getHttpServer())
        .post('/auctions')
        .send({
          giftId,
          totalGifts: 10,
          totalRounds: 3,
          roundDurationMs: 60000,
          minBid: 100,
        })
        .expect(401); // Unauthorized
    });

    it('should prevent unauthorized access to user-specific endpoints', async () => {
      // Try to get user balance without token
      await request(app.getHttpServer())
        .get(`/users/${user1Id}/balance`)
        .expect(401); // Unauthorized
    });
  });

  describe('Token reuse after user deletion', () => {
    it('should reject token after user is deleted', async () => {
      // Register user
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = registerResponse.body.access_token;
      const userId = registerResponse.body.user.id;

      // Verify token works
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Delete user
      await userModel.findByIdAndDelete(userId);

      // Try to use token after user deletion
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401); // Should reject - user no longer exists
    });
  });
});

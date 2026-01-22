import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';
import { UserDocument } from '../../models/user.schema';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let authService: any;
  let configService: any;

  const mockUser: Partial<UserDocument> = {
    _id: 'user123' as any,
    username: 'testuser',
    email: 'test@example.com',
    balance: 1000,
    lockedBalance: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'jwt.secret') return 'test-secret-key';
              return defaultValue;
            }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateUser: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    authService = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return user if validation succeeds', async () => {
      const payload = {
        sub: 'user123',
        username: 'testuser',
      };

      authService.validateUser.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);

      expect(result).toEqual(mockUser);
      expect(authService.validateUser).toHaveBeenCalledWith('user123');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const payload = {
        sub: 'user123',
        username: 'testuser',
      };

      authService.validateUser.mockRejectedValue(
        new UnauthorizedException('User not found'),
      );

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow('User not found');
      expect(authService.validateUser).toHaveBeenCalledWith('user123');
    });

    it('should extract userId from payload.sub', async () => {
      const payload = {
        sub: 'different-user-id',
        username: 'testuser',
      };

      authService.validateUser.mockResolvedValue(mockUser);

      await strategy.validate(payload);

      expect(authService.validateUser).toHaveBeenCalledWith('different-user-id');
    });

    it('should handle payload with only sub field', async () => {
      const payload = {
        sub: 'user123',
      };

      authService.validateUser.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload as any);

      expect(result).toEqual(mockUser);
      expect(authService.validateUser).toHaveBeenCalledWith('user123');
    });
  });

  describe('constructor', () => {
    it('should initialize with correct JWT options', () => {
      // Strategy is initialized in beforeEach
      expect(strategy).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith('jwt.secret', 'default-secret-key');
    });

    it('should use default secret if config not provided', async () => {
      const moduleWithDefault: TestingModule = await Test.createTestingModule({
        providers: [
          JwtStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'jwt.secret') return defaultValue;
                return defaultValue;
              }),
            },
          },
          {
            provide: AuthService,
            useValue: {
              validateUser: jest.fn(),
            },
          },
        ],
      }).compile();

      const strategyWithDefault = moduleWithDefault.get<JwtStrategy>(JwtStrategy);
      expect(strategyWithDefault).toBeDefined();
    });
  });
});

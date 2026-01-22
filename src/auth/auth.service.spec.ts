import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BalanceService } from '../services/balance/balance.service';
import { User, UserDocument } from '../models/user.schema';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: any;
  let jwtService: any;
  let configService: any;
  let balanceService: any;

  const mockUser = {
    _id: 'user123',
    username: 'testuser',
    email: 'test@example.com',
    password: 'hashedPassword123',
    balance: 1000,
    lockedBalance: 0,
    save: jest.fn(),
    toObject: jest.fn().mockReturnValue({
      _id: 'user123',
      username: 'testuser',
      email: 'test@example.com',
      balance: 1000,
      lockedBalance: 0,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'jwt.expiresIn') return '24h';
              if (key === 'jwt.secret') return 'test-secret';
              return defaultValue;
            }),
          },
        },
        {
          provide: BalanceService,
          useValue: {
            deposit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userModel = module.get(getModelToken(User.name));
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
    balanceService = module.get<BalanceService>(BalanceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      username: 'testuser',
      password: 'password123',
      email: 'test@example.com',
    };

    it('should register a new user successfully', async () => {
      // Mock: username doesn't exist
      userModel.findOne.mockResolvedValue(null);
      
      // Mock: create user
      userModel.create.mockResolvedValue(mockUser);
      
      // Mock: JWT token generation
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('access_token', 'jwt-token-123');
      expect(result).toHaveProperty('user');
      expect(result.user).toHaveProperty('id', 'user123');
      expect(result.user).toHaveProperty('username', 'testuser');
      expect(result.user).toHaveProperty('email', 'test@example.com');
      expect(userModel.findOne).toHaveBeenCalledWith({ username: 'testuser' });
      expect(userModel.create).toHaveBeenCalled();
      expect(jwtService.signAsync).toHaveBeenCalled();
    });

    it('should throw ConflictException if username already exists', async () => {
      // Mock: username already exists
      userModel.findOne.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow('Username already exists');
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('should hash password before saving', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      // Spy on hashPassword
      const hashPasswordSpy = jest.spyOn(service, 'hashPassword');

      await service.register(registerDto);

      expect(hashPasswordSpy).toHaveBeenCalledWith('password123');
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
          password: expect.any(String), // Hashed password
          email: 'test@example.com',
        }),
      );
    });

    it('should deposit initial balance if provided', async () => {
      const registerDtoWithBalance: RegisterDto = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com',
        initialBalance: 5000,
      };

      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);
      userModel.findById.mockResolvedValue({ ...mockUser, balance: 5000 });
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      await service.register(registerDtoWithBalance);

      expect(balanceService.deposit).toHaveBeenCalledWith(
        'user123',
        5000,
        expect.stringContaining('Initial balance deposit'),
      );
    });

    it('should not deposit initial balance if not provided', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      await service.register(registerDto);

      expect(balanceService.deposit).not.toHaveBeenCalled();
    });

    it('should register user without email', async () => {
      const registerDtoNoEmail: RegisterDto = {
        username: 'testuser',
        password: 'password123',
      };

      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue({ ...mockUser, email: undefined });
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      const result = await service.register(registerDtoNoEmail);

      expect(result.user.email).toBeUndefined();
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
          email: undefined,
        }),
      );
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      username: 'testuser',
      password: 'password123',
    };

    it('should login user with valid credentials', async () => {
      // Mock: user found with password
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      // Mock: password comparison
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      // Mock: JWT token generation
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('access_token', 'jwt-token-123');
      expect(result).toHaveProperty('user');
      expect(result.user).toHaveProperty('id', 'user123');
      expect(result.user).toHaveProperty('username', 'testuser');
      expect(userModel.findOne).toHaveBeenCalledWith({ username: 'testuser' });
      expect(jwtService.signAsync).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if user not found', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      // Mock: password comparison fails
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if user has no password', async () => {
      const userWithoutPassword = { ...mockUser, password: null };

      userModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(userWithoutPassword),
        }),
      });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('User account requires password setup');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should select password field when finding user', async () => {
      const selectMock = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      userModel.findOne.mockReturnValue({
        select: selectMock,
      });

      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jwtService.signAsync.mockResolvedValue('jwt-token-123');

      await service.login(loginDto);

      expect(selectMock).toHaveBeenCalledWith('+password');
    });
  });

  describe('validateUser', () => {
    it('should return user if found', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.validateUser('user123');

      expect(result).toEqual(mockUser);
      expect(userModel.findById).toHaveBeenCalledWith('user123');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.validateUser('user123')).rejects.toThrow(UnauthorizedException);
      await expect(service.validateUser('user123')).rejects.toThrow('User not found');
    });
  });

  describe('hashPassword', () => {
    it('should hash password using bcrypt', async () => {
      const password = 'password123';
      const hashedPassword = 'hashedPassword123';

      jest.spyOn(bcrypt, 'hash').mockResolvedValue(hashedPassword as never);

      const result = await service.hashPassword(password);

      expect(result).toBe(hashedPassword);
      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
    });

    it('should use salt rounds from service', async () => {
      const password = 'password123';
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await service.hashPassword(password);

      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
    });
  });

  describe('comparePassword', () => {
    it('should return true if passwords match', async () => {
      const password = 'password123';
      const hash = 'hashedPassword123';

      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.comparePassword(password, hash);

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hash);
    });

    it('should return false if passwords do not match', async () => {
      const password = 'password123';
      const hash = 'hashedPassword123';

      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      const result = await service.comparePassword(password, hash);

      expect(result).toBe(false);
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hash);
    });
  });

  describe('generateToken', () => {
    it('should generate JWT token with correct payload', async () => {
      const userId = 'user123';
      const username = 'testuser';
      const token = 'jwt-token-123';

      jwtService.signAsync.mockResolvedValue(token);

      // Access private method via reflection or test through public method
      // Since generateToken is private, we test it indirectly through register/login
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      await service.register({
        username,
        password: 'password123',
      });

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        {
          sub: userId,
          username: username,
        },
        expect.objectContaining({
          expiresIn: '24h',
        }),
      );
    });

    it('should use expiresIn from config', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'jwt.expiresIn') return '48h';
        if (key === 'jwt.secret') return 'test-secret';
        return undefined;
      });

      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);
      jwtService.signAsync.mockResolvedValue('token');

      await service.register({
        username: 'testuser',
        password: 'password123',
      });

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          expiresIn: '48h',
        }),
      );
    });
  });
});

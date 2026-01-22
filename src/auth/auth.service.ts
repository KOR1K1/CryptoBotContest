import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../models/user.schema';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { BalanceService } from '../services/balance/balance.service';

/**
 * AuthService
 * 
 * Handles authentication operations:
 * - User registration with password hashing
 * - User login with password verification
 * - JWT token generation
 * - User validation for JWT strategy
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds = 10;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private balanceService: BalanceService,
  ) {}

  /**
   * Register a new user
   * 
   * @param dto RegisterDto with username, password, optional email
   * @returns JWT token and user data
   * @throws ConflictException if username already exists
   */
  async register(dto: RegisterDto): Promise<{
    access_token: string;
    user: {
      id: string;
      username: string;
      email?: string;
      balance: number;
      lockedBalance: number;
    };
  }> {
    // Check if username already exists
    const existingUser = await this.userModel
      .findOne({ username: dto.username })
      .exec();

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Hash password
    const hashedPassword = await this.hashPassword(dto.password);

    // Create user
    const user = await this.userModel.create({
      username: dto.username,
      password: hashedPassword,
      email: dto.email,
      balance: 0,
      lockedBalance: 0,
    });

    // If initial balance is provided, deposit it
    if (dto.initialBalance && dto.initialBalance > 0) {
      await this.balanceService.deposit(
        user._id.toString(),
        dto.initialBalance,
        `Initial balance deposit for user ${dto.username}`,
      );
      // Reload user to get updated balance
      const updatedUser = await this.userModel.findById(user._id).exec();
      if (updatedUser) {
        user.balance = updatedUser.balance;
      }
    }

    // Generate JWT token
    const token = await this.generateToken(user._id.toString(), user.username);

    this.logger.log(`User registered: ${user.username} (${user._id})`);

    return {
      access_token: token,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        balance: user.balance,
        lockedBalance: user.lockedBalance,
      },
    };
  }

  /**
   * Login user
   * 
   * @param dto LoginDto with username and password
   * @returns JWT token and user data
   * @throws UnauthorizedException if credentials are invalid
   */
  async login(dto: LoginDto): Promise<{
    access_token: string;
    user: {
      id: string;
      username: string;
      email?: string;
      balance: number;
      lockedBalance: number;
    };
  }> {
    // Find user with password (select password field)
    const user = await this.userModel
      .findOne({ username: dto.username })
      .select('+password')
      .exec();

    if (!user) {
      this.logger.warn(`Login attempt with invalid username: ${dto.username}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has password (for backward compatibility with existing users)
    if (!user.password) {
      this.logger.warn(`Login attempt for user without password: ${dto.username}`);
      throw new UnauthorizedException('User account requires password setup. Please contact support.');
    }

    // Verify password
    const isPasswordValid = await this.comparePassword(
      dto.password,
      user.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Login attempt with invalid password for user: ${dto.username}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const token = await this.generateToken(user._id.toString(), user.username);

    this.logger.log(`User logged in: ${user.username} (${user._id})`);

    return {
      access_token: token,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        balance: user.balance,
        lockedBalance: user.lockedBalance,
      },
    };
  }

  /**
   * Validate user for JWT strategy
   * Called by JwtStrategy to verify token payload
   * 
   * @param userId User ID from JWT payload
   * @returns User document if valid
   * @throws UnauthorizedException if user not found
   */
  async validateUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Hash password using bcrypt
   * 
   * @param password Plain text password
   * @returns Hashed password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Compare plain password with hashed password
   * 
   * @param password Plain text password
   * @param hash Hashed password
   * @returns true if passwords match
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT token
   * 
   * @param userId User ID
   * @param username Username
   * @returns JWT token
   */
  private async generateToken(userId: string, username: string): Promise<string> {
    const payload = {
      sub: userId,
      username: username,
    };

    const expiresIn = this.configService.get<string>('jwt.expiresIn', '24h');

    return this.jwtService.signAsync(payload, {
      expiresIn,
    } as any);
  }
}

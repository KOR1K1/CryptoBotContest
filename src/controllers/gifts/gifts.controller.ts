import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Gift, GiftDocument } from '../../models/gift.schema';
import { CreateGiftDto } from '../../dto/create-gift.dto';
import { ParseMongoIdPipe } from '../../common/pipes/mongo-id.pipe';

/**
 * GiftsController
 *
 * Handles gift-related API endpoints
 */
@ApiTags('Gifts')
@Controller('gifts')
export class GiftsController {
  constructor(
    @InjectModel(Gift.name) private giftModel: Model<GiftDocument>,
  ) {}

  /**
   * POST /gifts
   * Create a new gift
   *
   * @param dto CreateGiftDto
   * @returns Created gift
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new gift', description: 'Creates a new gift that can be used in auctions' })
  @ApiResponse({ status: 201, description: 'Gift created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createGift(@Body() dto: CreateGiftDto) {
    const gift = await this.giftModel.create({
      title: dto.title,
      description: dto.description,
      imageUrl: dto.imageUrl,
      basePrice: dto.basePrice,
      totalSupply: dto.totalSupply,
      metadata: dto.metadata || {},
    });

    return {
      id: gift._id,
      title: gift.title,
      description: gift.description,
      imageUrl: gift.imageUrl,
      basePrice: gift.basePrice,
      totalSupply: gift.totalSupply,
      metadata: gift.metadata,
      createdAt: gift.createdAt,
    };
  }

  /**
   * GET /gifts
   * Get all gifts
   *
   * @returns Array of gifts
   */
  @Get()
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get all gifts', description: 'Returns a list of all available gifts' })
  @ApiResponse({ status: 200, description: 'List of gifts retrieved successfully' })
  async getGifts() {
    const gifts = await this.giftModel.find().sort({ createdAt: -1 }).exec();

    return gifts.map((g) => ({
      id: g._id,
      title: g.title,
      description: g.description,
      imageUrl: g.imageUrl,
      basePrice: g.basePrice,
      totalSupply: g.totalSupply,
      metadata: g.metadata,
      createdAt: g.createdAt,
    }));
  }

  /**
   * GET /gifts/:id
   * Get gift by ID
   *
   * @param id Gift ID
   * @returns Gift data
   */
  @Get(':id')
  @SkipThrottle() // Skip rate limiting for GET requests (read-only, safe)
  @ApiOperation({ summary: 'Get gift by ID', description: 'Returns gift details by ID' })
  @ApiParam({ name: 'id', description: 'Gift ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: 200, description: 'Gift retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Gift not found' })
  async getGift(@Param('id', ParseMongoIdPipe) id: string) {
    const gift = await this.giftModel.findById(id).exec();

    if (!gift) {
      throw new NotFoundException('Gift not found');
    }

    return {
      id: gift._id,
      title: gift.title,
      description: gift.description,
      imageUrl: gift.imageUrl,
      basePrice: gift.basePrice,
      totalSupply: gift.totalSupply,
      metadata: gift.metadata,
      createdAt: gift.createdAt,
      updatedAt: gift.updatedAt,
    };
  }
}


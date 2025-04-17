import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_TTL = 120 * 60 * 1000; // 120 min
const DEFAULT_TTL_EXCLUDE_ENTITY = 10 * 60 * 1000; // 10 min
const EXCLUDE_ENTITY = [
  'userbalance',
  'userbalances',
  'userbalancehistory',
  'userbalancehistories',
];

@Injectable()
export class CacheService {
  private cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(private configService: ConfigService) {}

  set(key: string, value: string, ttl: number) {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt });
  }

  get(key: string) {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    if (item.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  generateExpirationTime(query: string): number {
    if (EXCLUDE_ENTITY.some((entity) => query.toLowerCase().includes(entity))) {
      return DEFAULT_TTL_EXCLUDE_ENTITY;
    }
    return this.configService.get<number>('CACHE_TTL') || DEFAULT_TTL;
  }
}

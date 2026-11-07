import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getPositiveInteger } from '../utils/config.utils';
import { RedisCacheService } from './redis-cache.service';

const DEFAULT_TTL = 120 * 60 * 1000; // 120 min
const DEFAULT_TTL_EXCLUDE_ENTITY = 10 * 60 * 1000; // 10 min
const EXCLUDE_ENTITY = [
  'userbalance',
  'userbalances',
  'userbalancehistory',
  'userbalancehistories',
];

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache = new Map<
    string,
    { value: unknown; expiresAt: number; size: number }
  >();
  private readonly ttl: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private sizeBytes = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    configService: ConfigService,
    @Optional() private readonly redisCache?: RedisCacheService,
  ) {
    this.ttl = getPositiveInteger(configService, 'CACHE_TTL', DEFAULT_TTL);
    this.maxEntries = getPositiveInteger(
      configService,
      'CACHE_MAX_ENTRIES',
      1000,
    );
    this.maxBytes = getPositiveInteger(
      configService,
      'CACHE_MAX_BYTES',
      64 * 1024 * 1024,
    );
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) {
          this.delete(key);
        }
      }
    }, 60_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    this.cache.clear();
    this.sizeBytes = 0;
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    this.delete(key);
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      return;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return;
    }
    const size = Buffer.byteLength(key) + Buffer.byteLength(serialized);
    if (size > this.maxBytes) {
      return;
    }

    const storedInRedis =
      this.redisCache && (await this.redisCache.set(key, serialized, ttl));
    // Another write may have completed while this Redis operation was pending.
    this.delete(key);
    if (storedInRedis) {
      return;
    }

    while (
      this.cache.size >= this.maxEntries ||
      this.sizeBytes + size > this.maxBytes
    ) {
      this.delete(this.cache.keys().next().value);
    }

    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt, size });
    this.sizeBytes += size;
  }

  async get(key: string): Promise<unknown | null> {
    if (this.redisCache) {
      const serialized = await this.redisCache.get(key);
      if (serialized !== undefined) {
        if (serialized === null) return null;
        try {
          return JSON.parse(serialized);
        } catch {
          this.logger.warn(
            'Invalid Redis cache entry; treating it as a cache miss',
          );
          return null;
        }
      }
    }
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    if (item.expiresAt <= Date.now()) {
      this.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  private delete(key: string) {
    const entry = this.cache.get(key);
    if (entry) {
      this.sizeBytes -= entry.size;
      this.cache.delete(key);
    }
  }

  generateExpirationTime(query: string): number {
    if (EXCLUDE_ENTITY.some((entity) => query.toLowerCase().includes(entity))) {
      return DEFAULT_TTL_EXCLUDE_ENTITY;
    }
    return this.ttl;
  }
}

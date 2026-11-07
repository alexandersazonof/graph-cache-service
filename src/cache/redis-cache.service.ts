import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { getBoolean, getPositiveInteger } from '../utils/config.utils';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly enabled: boolean;
  private readonly url?: string;
  private readonly timeout: number;
  private readonly prefix: string;
  private client?: Redis;
  private unavailableLogged = false;

  constructor(
    config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.enabled = getBoolean(config, 'REDIS_ENABLED', false);
    this.metrics?.setRedisEnabled(this.enabled);
    this.metrics?.setRedisReady(false);
    if (!this.enabled) return;

    const url = config.get<string>('REDIS_URL');
    try {
      const parsed = new URL(url);
      if (
        !['redis:', 'rediss:'].includes(parsed.protocol) ||
        !parsed.hostname
      ) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'REDIS_URL must be a redis:// or rediss:// URL when REDIS_ENABLED=true',
      );
    }
    this.url = url;
    this.timeout = getPositiveInteger(config, 'REDIS_TIMEOUT_MS', 1000);
    this.prefix = config.get<string>('REDIS_KEY_PREFIX', 'graph-cache:v1:');
    if (typeof this.prefix !== 'string' || this.prefix.length === 0) {
      throw new Error('REDIS_KEY_PREFIX must be a non-empty string');
    }
  }

  async onModuleInit() {
    if (!this.enabled) return;
    this.client = new Redis(this.url, {
      lazyConnect: true,
      keyPrefix: this.prefix,
      connectTimeout: this.timeout,
      commandTimeout: this.timeout,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
    });
    this.client.on('error', () => {
      this.metrics?.setRedisReady(false);
      this.warnUnavailable();
    });
    this.client.on('close', () => this.metrics?.setRedisReady(false));
    this.client.on('ready', () => {
      this.metrics?.setRedisReady(true);
      this.unavailableLogged = false;
      this.logger.log('Redis cache connected');
    });
    try {
      await this.client.connect();
    } catch {
      this.metrics?.incrementRedisError('connect');
      this.warnUnavailable();
    }
  }

  // undefined means unavailable; null is an actual Redis cache miss.
  async get(key: string): Promise<string | null | undefined> {
    if (this.client?.status !== 'ready') return undefined;
    try {
      return await this.client.get(key);
    } catch {
      this.metrics?.incrementRedisError('get');
      this.warnUnavailable();
      return undefined;
    }
  }

  async set(key: string, serialized: string, ttl: number): Promise<boolean> {
    if (this.client?.status !== 'ready') return false;
    try {
      return (await this.client.set(key, serialized, 'PX', ttl)) === 'OK';
    } catch {
      this.metrics?.incrementRedisError('set');
      this.warnUnavailable();
      return false;
    }
  }

  async onModuleDestroy() {
    this.metrics?.setRedisReady(false);
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      if (client.status === 'ready') await client.quit();
    } catch {
      // Shutdown still closes the socket and stops reconnection attempts.
    } finally {
      client.disconnect();
    }
  }

  private warnUnavailable() {
    if (!this.unavailableLogged) {
      this.unavailableLogged = true;
      // Avoid logging connection URLs or errors that could contain credentials.
      this.logger.warn(
        'Redis unavailable; using the in-memory cache until it recovers',
      );
    }
  }
}

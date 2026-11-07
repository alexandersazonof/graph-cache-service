import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { RedisCacheService } from './redis-cache.service';

describe('CacheService with Redis', () => {
  let cache: CacheService;
  let redis: jest.Mocked<Pick<RedisCacheService, 'get' | 'set'>>;

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(false),
    };
    const config = { get: () => undefined } as unknown as ConfigService;
    cache = new CacheService(config, redis as unknown as RedisCacheService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.useFakeTimers();
  });

  afterEach(() => {
    cache.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns shared Redis values as JSON objects', async () => {
    const value = { data: { id: 'shared-response' } };
    redis.get.mockResolvedValueOnce(JSON.stringify(value));
    expect(await cache.get('key')).toEqual(value);
  });

  it('uses local fallback with expiration while Redis is unavailable', async () => {
    await cache.set('key', { data: 'local' }, 1000);
    expect(await cache.get('key')).toEqual({ data: 'local' });
    jest.advanceTimersByTime(1000);
    expect(await cache.get('key')).toBeNull();
  });

  it('does not serve old local fallback data when healthy Redis reports a miss', async () => {
    await cache.set('key', { data: 'local' }, 1000);
    redis.get.mockResolvedValueOnce(null);
    expect(await cache.get('key')).toBeNull();
  });

  it('stores successful Redis writes without retaining another copy in local memory', async () => {
    redis.set.mockResolvedValueOnce(true);
    const value = { data: 'redis' };
    await cache.set('key', value, 1234);
    expect(redis.set).toHaveBeenCalledWith('key', JSON.stringify(value), 1234);
    expect(await cache.get('key')).toBeNull();
  });

  it('treats malformed Redis JSON as a miss', async () => {
    redis.get.mockResolvedValueOnce('broken JSON');
    expect(await cache.get('key')).toBeNull();
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
  });

  it('accounts for concurrent fallback writes to the same key without losing byte capacity', async () => {
    const config = {
      get: (key: string) => (key === 'CACHE_MAX_BYTES' ? 8 : undefined),
    } as ConfigService;
    cache = new CacheService(config, redis as unknown as RedisCacheService);
    await Promise.all([cache.set('a', 'x', 1000), cache.set('a', 'y', 1000)]);
    await cache.set('b', 'z', 1000);
    expect(await cache.get('a')).toBe('y');
    expect(await cache.get('b')).toBe('z');
  });
});

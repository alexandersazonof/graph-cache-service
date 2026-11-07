import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

function config(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('CacheService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('converts an env TTL to milliseconds and expires at the exact boundary', async () => {
    const cache = new CacheService(config({ CACHE_TTL: '1000' }));
    await cache.set(
      'key',
      { data: 'value' },
      cache.generateExpirationTime('{ pools }'),
    );

    jest.advanceTimersByTime(999);
    expect(await cache.get('key')).toEqual({ data: 'value' });
    jest.advanceTimersByTime(1);
    expect(await cache.get('key')).toBeNull();
  });

  it('preserves default and balance-specific TTLs', async () => {
    const cache = new CacheService(config());
    expect(cache.generateExpirationTime('{ pools }')).toBe(7_200_000);
    expect(cache.generateExpirationTime('{ userBalances }')).toBe(600_000);
  });

  describe.each(['CACHE_TTL', 'CACHE_MAX_ENTRIES', 'CACHE_MAX_BYTES'])(
    '%s',
    (key) => {
      it.each(['', 'bad', '0', '-1', '1.5', 'Infinity', '2147483648', true])(
        'rejects invalid configuration %p',
        (value) => {
          expect(() => new CacheService(config({ [key]: value }))).toThrow(key);
        },
      );
    },
  );

  it('evicts the least recently used entry at the entry limit', async () => {
    const cache = new CacheService(config({ CACHE_MAX_ENTRIES: '2' }));
    await cache.set('a', 'first', 1000);
    await cache.set('b', 'second', 1000);
    expect(await cache.get('a')).toBe('first');

    await cache.set('c', 'third', 1000);
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).toBe('first');
    expect(await cache.get('c')).toBe('third');
  });

  it('enforces the byte budget including UTF-8 keys and payloads', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '7' }));
    await cache.set('a', 'x', 1000); // 1 byte key + 3 byte JSON string
    await cache.set('б', 'я', 1000); // 2 byte key + 4 byte JSON string

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('б')).toBe('я');
  });

  it('skips oversized responses without evicting other entries', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '8' }));
    await cache.set('a', 'x', 1000);
    await cache.set('large', 'oversized', 1000);
    expect(await cache.get('large')).toBeNull();
    expect(await cache.get('a')).toBe('x');
  });

  it('releases the byte budget when overwriting and expiring entries', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '8' }));
    await cache.set('a', 'x', 1000);
    await cache.set('a', 'y', 1000);
    await cache.set('b', 'z', 1000);
    expect(await cache.get('a')).toBe('y');
    expect(await cache.get('b')).toBe('z');

    jest.advanceTimersByTime(1000);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    await cache.set('c', 'x', 1000);
    await cache.set('d', 'y', 1000);
    expect(await cache.get('c')).toBe('x');
    expect(await cache.get('d')).toBe('y');
  });

  it('accepts a response exactly at the byte limit', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '4' }));
    await cache.set('a', 'x', 1000);
    expect(await cache.get('a')).toBe('x');
  });

  it('evicts as many entries as needed to fit a larger response', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '12' }));
    await cache.set('a', 'x', 1000);
    await cache.set('b', 'y', 1000);
    await cache.set('c', 'z', 1000);
    await cache.set('d', '12345', 1000);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).toBe('z');
    expect(await cache.get('d')).toBe('12345');
  });

  it('replaces an entry when the entry limit is one', async () => {
    const cache = new CacheService(config({ CACHE_MAX_ENTRIES: '1' }));
    await cache.set('a', 'old', 1000);
    await cache.set('a', 'new', 1000);
    expect(await cache.get('a')).toBe('new');
    await cache.set('b', 'next', 1000);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBe('next');
  });

  it.each([0, -1, NaN, Infinity])(
    'does not retain an entry with TTL %p',
    async (ttl) => {
      const cache = new CacheService(config());
      await cache.set('a', 'old', 1000);
      await cache.set('a', 'new', ttl);
      expect(await cache.get('a')).toBeNull();
    },
  );

  it('releases byte capacity during periodic cleanup', async () => {
    const cache = new CacheService(config({ CACHE_MAX_BYTES: '8' }));
    cache.onModuleInit();
    try {
      await cache.set('a', 'x', 1000);
      await cache.set('b', 'y', 1000);
      jest.advanceTimersByTime(60_000);
      await cache.set('c', 'z', 1000);
      await cache.set('d', 'w', 1000);
      expect(await cache.get('c')).toBe('z');
      expect(await cache.get('d')).toBe('w');
    } finally {
      cache.onModuleDestroy();
    }
  });

  it('cleans unread expired entries periodically and stops on module destroy', async () => {
    const cache = new CacheService(config({ CACHE_MAX_ENTRIES: '2' }));
    cache.onModuleInit();
    await cache.set('live', 'value', 120_000);
    await cache.set('expired', 'value', 1000);

    jest.advanceTimersByTime(60_000);
    await cache.set('new', 'value', 120_000);
    expect(await cache.get('live')).toBe('value');
    expect(await cache.get('expired')).toBeNull();

    cache.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    expect(await cache.get('live')).toBeNull();
  });
});

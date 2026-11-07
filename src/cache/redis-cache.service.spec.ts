import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

jest.mock('ioredis', () => ({ Redis: jest.fn() }));
const RedisMock = jest.mocked(Redis);

function config(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as ConfigService;
}

function createClient() {
  const client = Object.assign(new EventEmitter(), {
    status: 'wait',
    connect: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  });
  client.connect.mockImplementation(async () => {
    client.status = 'ready';
    client.emit('ready');
  });
  return client;
}

describe('RedisCacheService', () => {
  let client: ReturnType<typeof createClient>;
  let service: RedisCacheService;
  const settings = {
    REDIS_ENABLED: 'true',
    REDIS_URL: 'redis://localhost:6379/0',
  };

  beforeEach(() => {
    RedisMock.mockReset();
    client = createClient();
    RedisMock.mockImplementation(() => client as unknown as Redis);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    service = undefined;
    jest.restoreAllMocks();
  });

  it.each([undefined, false, 'false'])(
    'does not create a connection when REDIS_ENABLED=%p',
    async (enabled) => {
      service = new RedisCacheService(
        config({
          REDIS_ENABLED: enabled,
          REDIS_URL: 'ignored',
          REDIS_TIMEOUT_MS: 'ignored',
        }),
      );
      await service.onModuleInit();
      expect(await service.get('key')).toBeUndefined();
      expect(await service.set('key', '{}', 1000)).toBe(false);
      expect(RedisMock).not.toHaveBeenCalled();
    },
  );

  it.each(['yes', '0', '1', '', 1])(
    'rejects an invalid enable flag %p',
    (enabled) => {
      expect(
        () => new RedisCacheService(config({ REDIS_ENABLED: enabled })),
      ).toThrow('REDIS_ENABLED');
    },
  );

  it.each([undefined, '', 'http://localhost', 'not-a-url'])(
    'requires a valid Redis URL when enabled (%p)',
    (url) => {
      expect(
        () => new RedisCacheService(config({ ...settings, REDIS_URL: url })),
      ).toThrow('REDIS_URL');
      expect(RedisMock).not.toHaveBeenCalled();
    },
  );

  it('connects with TLS URLs, prefixes, timeouts and no offline command queue', async () => {
    service = new RedisCacheService(
      config({
        ...settings,
        REDIS_ENABLED: true,
        REDIS_URL: 'rediss://user:password@redis.example:25061/0',
        REDIS_TIMEOUT_MS: '250',
        REDIS_KEY_PREFIX: 'test-cache:',
      }),
    );
    await service.onModuleInit();
    expect(RedisMock).toHaveBeenCalledWith(
      'rediss://user:password@redis.example:25061/0',
      expect.objectContaining({
        lazyConnect: true,
        keyPrefix: 'test-cache:',
        connectTimeout: 250,
        commandTimeout: 250,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
        maxRetriesPerRequest: 1,
      }),
    );
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('round-trips serialized values and uses a millisecond TTL', async () => {
    service = new RedisCacheService(config(settings));
    await service.onModuleInit();
    const serialized = JSON.stringify({ data: { pools: [{ id: '1' }] } });
    expect(await service.set('key', serialized, 1234)).toBe(true);
    expect(client.set).toHaveBeenCalledWith('key', serialized, 'PX', 1234);
    client.get.mockResolvedValueOnce(serialized);
    expect(await service.get('key')).toBe(serialized);
    expect(await service.get('missing')).toBeNull();
  });

  it('allows startup and local fallback when the initial connection fails', async () => {
    client.connect.mockRejectedValueOnce(new Error('connection refused'));
    service = new RedisCacheService(config(settings));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(await service.get('key')).toBeUndefined();
    expect(await service.set('key', '{}', 1000)).toBe(false);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('falls back on command errors and logs no credentials', async () => {
    service = new RedisCacheService(config(settings));
    await service.onModuleInit();
    client.get.mockRejectedValueOnce(new Error('secret-password'));
    client.set.mockRejectedValueOnce(new Error('secret-password'));
    expect(await service.get('key')).toBeUndefined();
    expect(await service.set('key', '{}', 1000)).toBe(false);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(Logger.prototype.warn).mock.calls.flat().join(' '),
    ).not.toContain('secret-password');
  });

  it('skips commands while reconnecting and resumes after recovery', async () => {
    service = new RedisCacheService(config(settings));
    await service.onModuleInit();
    client.status = 'reconnecting';
    client.emit('error', new Error('offline'));
    expect(await service.get('key')).toBeUndefined();
    expect(await service.set('key', '{}', 1000)).toBe(false);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();

    client.status = 'ready';
    client.emit('ready');
    expect(await service.set('key', '{}', 1000)).toBe(true);
    client.emit('error', new Error('offline again'));
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'closes the socket even if graceful shutdown fails (%p)',
    async (fails) => {
      service = new RedisCacheService(config(settings));
      await service.onModuleInit();
      if (fails)
        client.quit.mockRejectedValueOnce(new Error('connection lost'));
      await service.onModuleDestroy();
      expect(client.quit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalledTimes(1);
      expect(await service.get('key')).toBeUndefined();
    },
  );

  it('stops reconnecting without issuing QUIT to an offline server', async () => {
    service = new RedisCacheService(config(settings));
    await service.onModuleInit();
    client.status = 'reconnecting';
    await service.onModuleDestroy();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});

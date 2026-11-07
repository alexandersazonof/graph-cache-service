import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CacheService } from '../cache/cache.service';
import { MetricsService } from '../metrics/metrics.service';
import { NetworkUtils } from '../utils/network.utils';
import { GraphService } from './graph.service';

jest.mock('axios');
const post = jest.mocked(axios.post);

describe('GraphService upstream requests', () => {
  let service: GraphService;
  let metrics: jest.Mocked<
    Pick<
      MetricsService,
      | 'incrementGraphRequestCount'
      | 'incrementGraphChainRequestCount'
      | 'incrementGraphInRequestCount'
      | 'recordCacheLookup'
      | 'incrementDeduplicatedRequestCount'
      | 'startGraphUpstreamTimer'
    >
  >;
  const request = { query: '{ pools { id } }', variables: { first: 1 } };
  const response = { data: { pools: [{ id: '1' }] } };

  function createService(values: Record<string, unknown> = {}) {
    const config = {
      get: (key: string, fallback?: unknown) =>
        ({
          ETH_URL: 'https://graph.example/eth',
          POLYGON_URL: 'https://graph.example/polygon',
          ETH_EXPLORER_URL: 'https://explorer.example/eth',
          EXPLORER_API_KEY: 'test-key',
          HYPE_EVM_URL: 'https://custom.example/graphql',
          ...values,
        })[key] ?? fallback,
    } as ConfigService;
    metrics = {
      incrementGraphRequestCount: jest.fn(),
      incrementGraphChainRequestCount: jest.fn(),
      incrementGraphInRequestCount: jest.fn(),
      recordCacheLookup: jest.fn(),
      incrementDeduplicatedRequestCount: jest.fn(),
      startGraphUpstreamTimer: jest.fn().mockImplementation(() => jest.fn()),
    };
    return new GraphService(
      new NetworkUtils(config),
      new CacheService(config),
      config,
      metrics as unknown as MetricsService,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    post.mockReset();
    service = createService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('shares one upstream request among concurrent callers and caches the result', async () => {
    let resolve: (value: { data: typeof response }) => void;
    post.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const calls = Array.from({ length: 20 }, () =>
      service.execute('1', 'version/latest', request),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(metrics.incrementDeduplicatedRequestCount).toHaveBeenCalledTimes(19);
    expect(metrics.startGraphUpstreamTimer).toHaveBeenCalledTimes(1);
    resolve({ data: response });
    expect(await Promise.all(calls)).toEqual(Array(20).fill(response));
    expect(await service.execute('1', 'version/latest', request)).toEqual(
      response,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheLookup.mock.calls).toEqual([
      ...Array(20).fill(['1', 'miss']),
      ['1', 'hit'],
    ]);
  });

  it('keeps different chains, versions, variables and queries independent', async () => {
    post.mockResolvedValue({ data: response });
    await Promise.all([
      service.execute('1', 'v1', request),
      service.execute('137', 'v1', request),
      service.execute('1', 'v2', request),
      service.execute('1', 'v1', { ...request, variables: { first: 2 } }),
      service.execute('1', 'v1', { query: '{ vaults { id } }' }),
    ]);
    expect(post).toHaveBeenCalledTimes(5);
  });

  it('applies the default timeout to upstream calls', async () => {
    post.mockResolvedValue({ data: response });
    await service.execute('1', 'v1', request);
    expect(post).toHaveBeenCalledWith(
      'https://graph.example/eth/v1',
      request,
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('shares retries and explorer fallback and applies a configured timeout to each', async () => {
    service = createService({ GRAPH_REQUEST_TIMEOUT_MS: '1500' });
    post
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: response });
    const calls = [
      service.execute('1', 'v1', request),
      service.execute('1', 'v1', request),
    ];
    const results = Promise.all(calls);
    await jest.runAllTimersAsync();
    expect(await results).toEqual([response, response]);
    expect(post).toHaveBeenCalledTimes(3);
    expect(metrics.startGraphUpstreamTimer.mock.calls).toEqual([
      ['1', 'graph'],
      ['1', 'graph'],
      ['1', 'explorer'],
    ]);
    const timers = metrics.startGraphUpstreamTimer.mock.results;
    expect(timers[0].value).toHaveBeenCalledWith('error');
    expect(timers[1].value).toHaveBeenCalledWith('error');
    expect(timers[2].value).toHaveBeenCalledWith('success');
    for (const [, , options] of post.mock.calls) {
      expect(options.timeout).toBe(1500);
    }
    expect(post).toHaveBeenLastCalledWith(
      'https://explorer.example/eth',
      request,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('labels custom infrastructure separately without changing its URL or auth', async () => {
    post.mockResolvedValue({ data: response });
    await service.execute('999', 'v1', request);
    expect(metrics.startGraphUpstreamTimer).toHaveBeenCalledWith(
      '999',
      'custom',
    );
    expect(post).toHaveBeenCalledWith(
      'https://custom.example/graphql',
      request,
      { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 },
    );
  });

  it('releases failed requests so a later call can try again', async () => {
    post.mockRejectedValue(new Error('upstream unavailable'));
    const calls = [
      service.execute('1', 'v1', request),
      service.execute('1', 'v1', request),
    ];
    const results = Promise.allSettled(calls);
    await jest.runAllTimersAsync();
    expect((await results).map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(post).toHaveBeenCalledTimes(4);
    expect(metrics.startGraphUpstreamTimer.mock.calls).toEqual([
      ['1', 'graph'],
      ['1', 'graph'],
      ['1', 'explorer'],
      ['1', 'explorer'],
    ]);
    for (const timer of metrics.startGraphUpstreamTimer.mock.results) {
      expect(timer.value).toHaveBeenCalledWith('error');
    }

    post.mockResolvedValue({ data: response });
    expect(await service.execute('1', 'v1', request)).toEqual(response);
    expect(post).toHaveBeenCalledTimes(5);
  });

  it('fetches again after the cached response expires', async () => {
    service = createService({ CACHE_TTL: '1000' });
    post.mockResolvedValue({ data: response });
    await service.execute('1', 'v1', request);
    jest.advanceTimersByTime(1000);
    await service.execute('1', 'v1', request);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('waits for the existing retry delay and stays on the primary source if it recovers', async () => {
    post
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ data: response });
    const execution = service.execute('1', 'v1', request);
    await jest.advanceTimersByTimeAsync(999);
    expect(post).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await execution).toEqual(response);
    expect(post.mock.calls.map(([url]) => url)).toEqual([
      'https://graph.example/eth/v1',
      'https://graph.example/eth/v1',
    ]);
    expect(metrics.startGraphUpstreamTimer.mock.calls).toEqual([
      ['1', 'graph'],
      ['1', 'graph'],
    ]);
  });

  it('does not call an explorer when no fallback URL is configured', async () => {
    service = createService({ ETH_EXPLORER_URL: undefined });
    post.mockRejectedValue(new Error('primary unavailable'));
    const result = expect(service.execute('1', 'v1', request)).rejects.toThrow(
      'Failed to execute request after 2 attempts',
    );
    await jest.runAllTimersAsync();
    await result;
    expect(post).toHaveBeenCalledTimes(2);
    expect(metrics.startGraphUpstreamTimer.mock.calls).toEqual([
      ['1', 'graph'],
      ['1', 'graph'],
    ]);
  });

  it('preserves custom-source retries and authorizes only the explorer fallback', async () => {
    post
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ data: response });
    const execution = service.execute('999', 'v1', request);
    await jest.runAllTimersAsync();
    expect(await execution).toEqual(response);
    expect(post.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill('https://custom.example/graphql'),
    );
    expect(
      post.mock.calls.map(([, , options]) => options.headers.Authorization),
    ).toEqual([undefined, undefined, 'Bearer test-key']);
    expect(metrics.startGraphUpstreamTimer.mock.calls).toEqual([
      ['999', 'custom'],
      ['999', 'custom'],
      ['999', 'explorer'],
    ]);
  });

  it('records a GraphQL error as a failed attempt and caches only the recovered response', async () => {
    post
      .mockResolvedValueOnce({
        data: { errors: [{ message: 'Indexing error' }] },
      })
      .mockResolvedValueOnce({ data: response });
    const execution = service.execute('1', 'v1', request);
    await jest.runAllTimersAsync();
    expect(await execution).toEqual(response);
    expect(await service.execute('1', 'v1', request)).toEqual(response);
    expect(post).toHaveBeenCalledTimes(2);
    expect(
      metrics.startGraphUpstreamTimer.mock.results[0].value,
    ).toHaveBeenCalledWith('error');
    expect(
      metrics.startGraphUpstreamTimer.mock.results[1].value,
    ).toHaveBeenCalledWith('success');
  });

  it.each(['0', '-1', 'bad', 'Infinity', '2147483648'])(
    'rejects an invalid timeout %s',
    (timeout) => {
      expect(() =>
        createService({ GRAPH_REQUEST_TIMEOUT_MS: timeout }),
      ).toThrow('GRAPH_REQUEST_TIMEOUT_MS');
    },
  );
});

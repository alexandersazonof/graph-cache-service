import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { register } from 'prom-client';
import { MetricsModule } from './metrics.module';
import { MetricsService } from './metrics.service';
import { MetricsMiddleware } from './metrics.middleware';

describe('Prometheus metrics', () => {
  let module: TestingModule;
  let metrics: MetricsService;

  beforeEach(async () => {
    register.clear();
    module = await Test.createTestingModule({
      imports: [MetricsModule],
    }).compile();
    await module.init();
    metrics = module.get(MetricsService);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await module.close();
    register.clear();
  });

  async function values(name: string) {
    return (await register.getSingleMetric(name).get()).values;
  }

  it('exports cache lookup outcomes and in-flight sharing separately', async () => {
    metrics.recordCacheLookup('1', 'miss');
    metrics.recordCacheLookup('1', 'miss');
    metrics.incrementDeduplicatedRequestCount('1');
    metrics.recordCacheLookup('1', 'hit');
    expect(await values('graph_cache_requests_total')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { chainId: '1', result: 'hit' },
          value: 1,
        }),
        expect.objectContaining({
          labels: { chainId: '1', result: 'miss' },
          value: 2,
        }),
      ]),
    );
    expect(await values('graph_deduplicated_requests_total')).toEqual([
      expect.objectContaining({ labels: { chainId: '1' }, value: 1 }),
    ]);
  });

  it('exports Redis configuration, readiness and failures for external alerting', async () => {
    metrics.setRedisEnabled(false);
    metrics.setRedisReady(false);
    expect(await values('redis_cache_enabled')).toEqual([
      expect.objectContaining({ value: 0 }),
    ]);
    metrics.setRedisEnabled(true);
    metrics.setRedisReady(true);
    metrics.incrementRedisError('get');
    expect(await values('redis_cache_enabled')).toEqual([
      expect.objectContaining({ value: 1 }),
    ]);
    expect(await values('redis_cache_ready')).toEqual([
      expect.objectContaining({ value: 1 }),
    ]);
    expect(await values('redis_cache_errors_total')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { operation: 'get' }, value: 1 }),
        expect.objectContaining({ labels: { operation: 'connect' }, value: 0 }),
      ]),
    );
    metrics.setRedisReady(false);
    expect(await values('redis_cache_ready')).toEqual([
      expect.objectContaining({ value: 0 }),
    ]);
  });

  it('exports zero hits for a cold cache so hit rate does not disappear', async () => {
    metrics.recordCacheLookup('1', 'miss');
    expect(await values('graph_cache_requests_total')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { chainId: '1', result: 'hit' },
          value: 0,
        }),
        expect.objectContaining({
          labels: { chainId: '1', result: 'miss' },
          value: 1,
        }),
      ]),
    );
  });

  it('records elapsed time and outcomes per upstream source', async () => {
    jest.useFakeTimers();
    const graph = metrics.startGraphUpstreamTimer('1', 'graph');
    jest.advanceTimersByTime(250);
    graph('error');
    const explorer = metrics.startGraphUpstreamTimer('1', 'explorer');
    jest.advanceTimersByTime(500);
    explorer('success');
    const custom = metrics.startGraphUpstreamTimer('999', 'custom');
    jest.advanceTimersByTime(100);
    custom('success');

    const samples = await values('graph_upstream_request_duration_seconds');
    expect(samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'graph_upstream_request_duration_seconds_sum',
          labels: { chainId: '1', source: 'graph', outcome: 'error' },
          value: 0.25,
        }),
        expect.objectContaining({
          metricName: 'graph_upstream_request_duration_seconds_sum',
          labels: { chainId: '1', source: 'explorer', outcome: 'success' },
          value: 0.5,
        }),
        expect.objectContaining({
          metricName: 'graph_upstream_request_duration_seconds_count',
          labels: { chainId: '999', source: 'custom', outcome: 'success' },
          value: 1,
        }),
      ]),
    );
    expect(await register.metrics()).toContain(
      'graph_upstream_request_duration_seconds_bucket',
    );
  });

  it('measures completed HTTP requests and preserves method and status labels', async () => {
    jest.useFakeTimers();
    const middleware = new MetricsMiddleware(metrics);
    const response = Object.assign(new EventEmitter(), { statusCode: 429 });
    const next = jest.fn();
    middleware.use(
      { method: 'POST', path: '/1' } as Request,
      response as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1250);
    response.emit('finish');

    expect(await values('requests_total')).toEqual([
      expect.objectContaining({
        labels: { method: 'POST', status: 429 },
        value: 1,
      }),
    ]);
    expect(await values('too_many_requests_total')).toEqual([
      expect.objectContaining({ value: 1 }),
    ]);
    expect(await values('http_request_duration_seconds')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'http_request_duration_seconds_sum',
          labels: { method: 'POST', status: '429' },
          value: 1.25,
        }),
      ]),
    );
  });

  it('excludes metrics scraping from HTTP counts and duration', async () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = jest.fn();
    new MetricsMiddleware(metrics).use(
      { method: 'GET', path: '/metrics' } as Request,
      response as unknown as Response,
      next,
    );
    response.emit('finish');
    expect(next).toHaveBeenCalledTimes(1);
    expect(await values('http_request_duration_seconds')).toEqual([]);
    expect(await values('requests_total')).toEqual([]);
  });

  it('bounds new label values for arbitrary chain IDs and HTTP methods', async () => {
    metrics.recordCacheLookup('user-controlled-chain', 'miss');
    metrics.incrementDeduplicatedRequestCount('another-chain');
    metrics.startGraphUpstreamTimer('user-controlled-chain', 'graph')('error');
    metrics.startHttpRequestTimer('CUSTOM-METHOD')(400);
    expect(await values('graph_cache_requests_total')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { chainId: 'unknown', result: 'hit' },
          value: 0,
        }),
        expect.objectContaining({
          labels: { chainId: 'unknown', result: 'miss' },
          value: 1,
        }),
      ]),
    );
    expect(await values('graph_deduplicated_requests_total')).toEqual([
      expect.objectContaining({ labels: { chainId: 'unknown' } }),
    ]);
    expect(await values('http_request_duration_seconds')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'http_request_duration_seconds_count',
          labels: { method: 'OTHER', status: '400' },
          value: 1,
        }),
      ]),
    );
  });

  it.each(['/metrics', '/metrics?probe=1', '/metrics/', '/METRICS'])(
    'excludes %s even when Nest strips the mounted path',
    async (originalUrl) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      const next = jest.fn();
      new MetricsMiddleware(metrics).use(
        { method: 'GET', path: '/', originalUrl } as Request,
        response as unknown as Response,
        next,
      );
      response.emit('finish');
      expect(next).toHaveBeenCalledTimes(1);
      expect(await values('http_request_duration_seconds')).toEqual([]);
      expect(await values('requests_total')).toEqual([]);
    },
  );
});

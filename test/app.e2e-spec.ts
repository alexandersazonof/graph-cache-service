import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import axios from 'axios';
import { register } from 'prom-client';
import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { AppModule } from '../src/app.module';

jest.mock('axios');
jest.mock('ioredis', () => ({ Redis: jest.fn() }));
const post = jest.mocked(axios.post);
const RedisMock = jest.mocked(Redis);

function createRedisFixture() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const client = Object.assign(new EventEmitter(), {
    status: 'wait',
    connect: jest.fn(),
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.value;
    }),
    set: jest.fn(
      async (key: string, value: string, _mode: string, ttl: number) => {
        store.set(key, { value, expiresAt: Date.now() + ttl });
        return 'OK';
      },
    ),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  });
  client.connect.mockImplementation(async () => {
    client.status = 'ready';
    client.emit('ready');
  });
  return client;
}

describe.each(['memory', 'redis'])(
  'Graph cache service (HTTP, %s)',
  (backend) => {
    let app: INestApplication;
    let redis: ReturnType<typeof createRedisFixture>;
    const body = { query: '{ pools { id } }' };
    const response = { data: { pools: [{ id: 'pool-1' }] } };

    beforeEach(async () => {
      register.clear();
      post.mockReset();
      RedisMock.mockReset();
      redis = createRedisFixture();
      RedisMock.mockImplementation(() => redis as unknown as Redis);
      // All destinations and credentials are fixtures; no real upstream is contacted.
      const settings: Record<string, unknown> = {
        ETH_URL: 'https://graph.example/eth',
        ETH_EXPLORER_URL: 'https://explorer.example/eth',
        HYPE_EVM_URL: 'https://custom.example/graphql',
        EXPLORER_API_KEY: 'fixture-api-key',
        GRAPH_REQUEST_TIMEOUT_MS: '1000',
        CACHE_TTL: '60000',
        CACHE_MAX_BYTES: '1048576',
        CACHE_MAX_ENTRIES: '10',
        MAX_ALIAS_COUNT: 5,
        REDIS_ENABLED: backend === 'redis' ? 'true' : 'false',
        REDIS_URL: 'redis://localhost:6379/0',
      };
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue({
          get: (key: string, fallback?: unknown) => settings[key] ?? fallback,
        })
        .compile();

      app = module.createNestApplication();
      app.useLogger(false);
      await app.init();
      await app.listen(0, '127.0.0.1');
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
      register.clear();
    });

    async function metric(
      name: string,
      labels: Record<string, string | number>,
    ) {
      const { values } = await register.getSingleMetric(name).get();
      return values.find((sample) =>
        Object.entries(labels).every(
          ([key, value]) => sample.labels[key] === value,
        ),
      )?.value;
    }

    it('serves pong and excludes repeated metrics scrapes from HTTP counts', async () => {
      await request(app.getHttpServer()).get('/').expect(200).expect('pong');
      for (const path of [
        '/metrics',
        '/metrics?probe=1',
        '/metrics/',
        '/METRICS',
      ]) {
        const scrape = await request(app.getHttpServer())
          .get(path)
          .expect(200)
          .expect('Content-Type', /text\/plain/);
        expect(scrape.text).toContain('http_request_duration_seconds_bucket');
        expect(scrape.text).toContain(
          `redis_cache_enabled ${backend === 'redis' ? 1 : 0}`,
        );
        expect(scrape.text).toContain(
          `redis_cache_ready ${backend === 'redis' ? 1 : 0}`,
        );
      }
      expect(
        await metric('requests_total', { method: 'GET', status: 200 }),
      ).toBe(1);
      expect(
        await metric('http_request_duration_seconds', {
          method: 'GET',
          status: '200',
          le: '+Inf',
        }),
      ).toBe(1);
      expect(post).not.toHaveBeenCalled();
      if (backend === 'memory') {
        expect(RedisMock).not.toHaveBeenCalled();
      } else {
        expect(redis.connect).toHaveBeenCalledTimes(1);
      }
    });

    it('exports cache hits, misses and primary attempts after real HTTP requests', async () => {
      post.mockResolvedValue({ data: response });
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/1')
          .send(body)
          .expect(200)
          .expect(response);
      }
      expect(post).toHaveBeenCalledTimes(1);
      if (backend === 'redis') {
        expect(redis.set).toHaveBeenCalledWith(
          expect.any(String),
          JSON.stringify(response),
          'PX',
          60_000,
        );
        expect(redis.get).toHaveBeenCalledTimes(2);
      }
      expect(post).toHaveBeenCalledWith(
        'https://graph.example/eth/version/latest',
        body,
        { headers: { 'Content-Type': 'application/json' }, timeout: 1000 },
      );
      const scrape = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);
      expect(scrape.text).toContain(
        'graph_cache_requests_total{chainId="1",result="hit"} 1',
      );
      expect(scrape.text).toContain(
        'graph_cache_requests_total{chainId="1",result="miss"} 1',
      );
      expect(scrape.text).toContain(
        'graph_upstream_request_duration_seconds_count{chainId="1",source="graph",outcome="success"} 1',
      );
      expect(
        await metric('requests_total', { method: 'POST', status: 200 }),
      ).toBe(2);
      expect(scrape.text).not.toContain('fixture-api-key');
      expect(scrape.text).not.toContain('https://graph.example');
      expect(scrape.text).not.toContain(body.query);
    });

    it('forwards the requested version, variables and operation name unchanged', async () => {
      post.mockResolvedValue({ data: response });
      const namedBody = {
        query: 'query Pools($first: Int!) { pools(first: $first) { id } }',
        variables: { first: 10 },
        operationName: 'Pools',
      };
      await request(app.getHttpServer())
        .post('/1/v7')
        .send(namedBody)
        .expect(200)
        .expect(response);
      expect(post).toHaveBeenCalledWith(
        'https://graph.example/eth/v7',
        namedBody,
        expect.objectContaining({ timeout: 1000 }),
      );
    });

    it('exports primary retries and explorer fallback under their respective sources', async () => {
      post
        .mockRejectedValueOnce(new Error('primary unavailable'))
        .mockRejectedValueOnce(new Error('primary unavailable'))
        .mockResolvedValueOnce({ data: response });
      await request(app.getHttpServer())
        .post('/1')
        .send(body)
        .expect(200)
        .expect(response);
      expect(post.mock.calls.map(([url]) => url)).toEqual([
        'https://graph.example/eth/version/latest',
        'https://graph.example/eth/version/latest',
        'https://explorer.example/eth',
      ]);
      expect(
        post.mock.calls.map(([, , options]) => options.headers.Authorization),
      ).toEqual([undefined, undefined, 'Bearer fixture-api-key']);
      const scrape = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);
      expect(scrape.text).toContain(
        'graph_upstream_request_duration_seconds_count{chainId="1",source="graph",outcome="error"} 2',
      );
      expect(scrape.text).toContain(
        'graph_upstream_request_duration_seconds_count{chainId="1",source="explorer",outcome="success"} 1',
      );
      expect(
        await metric('requests_total', { method: 'POST', status: 200 }),
      ).toBe(1);
    });

    it('reports exhausted upstream rate limits as HTTP 429 and allows later recovery', async () => {
      post.mockRejectedValue({
        message: 'rate limited',
        response: { status: 429 },
      });
      const result = await request(app.getHttpServer())
        .post('/1')
        .send(body)
        .expect(429);
      expect(result.body).toMatchObject({
        statusCode: 429,
        message: 'Too Many Requests',
        path: '/1',
      });
      expect(post).toHaveBeenCalledTimes(4);
      expect(
        await metric('requests_total', { method: 'POST', status: 429 }),
      ).toBe(1);
      expect(await metric('too_many_requests_total', {})).toBe(1);
      expect(await metric('errors_total', {})).toBe(1);

      post.mockResolvedValue({ data: response });
      await request(app.getHttpServer())
        .post('/1')
        .send(body)
        .expect(200)
        .expect(response);
      expect(post).toHaveBeenCalledTimes(5);
    });

    it('rejects excess root selections before any cache lookup or upstream attempt', async () => {
      const result = await request(app.getHttpServer())
        .post('/1')
        .send({
          query:
            '{ a:pools{id} b:pools{id} c:pools{id} d:pools{id} e:pools{id} f:pools{id} }',
        })
        .expect(400);
      expect(result.body).toMatchObject({ statusCode: 400 });
      expect(post).not.toHaveBeenCalled();
      expect(
        (await register.getSingleMetric('graph_cache_requests_total').get())
          .values,
      ).toEqual([]);
      expect(
        (
          await register
            .getSingleMetric('graph_upstream_request_duration_seconds')
            .get()
        ).values,
      ).toEqual([]);
      expect(
        await metric('requests_total', { method: 'POST', status: 400 }),
      ).toBe(1);
    });

    if (backend === 'redis') {
      it('serves requests through local fallback when Redis commands fail', async () => {
        redis.get.mockRejectedValue(new Error('Redis unavailable'));
        redis.set.mockRejectedValue(new Error('Redis unavailable'));
        post.mockResolvedValue({ data: response });
        for (let i = 0; i < 2; i++) {
          await request(app.getHttpServer())
            .post('/1')
            .send(body)
            .expect(200)
            .expect(response);
        }
        expect(post).toHaveBeenCalledTimes(1);
        expect(
          await metric('redis_cache_errors_total', { operation: 'get' }),
        ).toBe(2);
        expect(
          await metric('redis_cache_errors_total', { operation: 'set' }),
        ).toBe(1);
        expect(
          await metric('graph_cache_requests_total', {
            chainId: '1',
            result: 'hit',
          }),
        ).toBe(1);
        expect(
          await metric('graph_cache_requests_total', {
            chainId: '1',
            result: 'miss',
          }),
        ).toBe(1);
      });
    }
  },
);

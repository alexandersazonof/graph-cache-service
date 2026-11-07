import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';

@Module({
  providers: [
    MetricsService,
    {
      provide: 'REDIS_CACHE_ENABLED',
      useFactory: () =>
        new Gauge({
          name: 'redis_cache_enabled',
          help: 'Whether Redis cache is enabled (1) or disabled (0)',
        }),
    },
    {
      provide: 'REDIS_CACHE_READY',
      useFactory: () =>
        new Gauge({
          name: 'redis_cache_ready',
          help: 'Whether the Redis cache connection is ready (1) or unavailable (0)',
        }),
    },
    {
      provide: 'REDIS_CACHE_ERRORS',
      useFactory: () => {
        const counter = new Counter({
          name: 'redis_cache_errors_total',
          help: 'Redis cache failures by operation',
          labelNames: ['operation'],
        });
        for (const operation of ['connect', 'get', 'set'])
          counter.inc({ operation }, 0);
        return counter;
      },
    },
    {
      provide: 'GRAPH_CACHE_REQUESTS',
      useFactory: () =>
        new Counter({
          name: 'graph_cache_requests_total',
          help: 'GraphQL cache lookups, including misses that share an in-flight request',
          labelNames: ['chainId', 'result'],
        }),
    },
    {
      provide: 'GRAPH_DEDUPLICATED_REQUESTS',
      useFactory: () =>
        new Counter({
          name: 'graph_deduplicated_requests_total',
          help: 'GraphQL cache misses served by an existing in-flight request',
          labelNames: ['chainId'],
        }),
    },
    {
      provide: 'HTTP_REQUEST_DURATION',
      useFactory: () =>
        new Histogram({
          name: 'http_request_duration_seconds',
          help: 'Completed HTTP request duration, excluding the metrics endpoint',
          labelNames: ['method', 'status'],
          buckets: [
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45,
            60,
          ],
        }),
    },
    {
      provide: 'GRAPH_UPSTREAM_DURATION',
      useFactory: () =>
        new Histogram({
          name: 'graph_upstream_request_duration_seconds',
          help: 'Individual upstream attempt duration, including failed attempts',
          labelNames: ['chainId', 'source', 'outcome'],
          buckets: [
            0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60,
          ],
        }),
    },
    {
      provide: 'ERRORS_COUNTER',
      useFactory: () => {
        return new Counter({
          name: 'errors_total',
          help: 'Total number of errors',
        });
      },
    },
    {
      provide: 'REQUESTS_COUNTER',
      useFactory: () => {
        return new Counter({
          name: 'requests_total',
          help: 'Total number of requests',
          labelNames: ['method', 'status'],
        });
      },
    },
    {
      provide: 'TOO_MANY_REQUESTS_COUNTER',
      useFactory: () => {
        return new Counter({
          name: 'too_many_requests_total',
          help: 'Total number of HTTP 429 responses',
        });
      },
    },
    {
      provide: 'GRAPH_TOTAL_REQUESTS',
      useFactory: () => {
        return new Counter({
          name: 'graph_total_requests',
          help: 'Total GraphQL requests',
          labelNames: ['chainId'],
        });
      },
    },
    {
      provide: 'GRAPH_TOTAL_CHAIN_REQUESTS',
      useFactory: () => {
        return new Counter({
          name: 'graph_total_chain_requests',
          help: 'Total GraphQL requests by chain',
          labelNames: ['chainId', 'version'],
        });
      },
    },
    {
      provide: 'GRAPH_TOTAL_ERRORS',
      useFactory: () => {
        return new Counter({
          name: 'graph_total_errors',
          help: 'Total GraphQL errors',
          labelNames: ['chainId'],
        });
      },
    },
    {
      provide: 'GRAPH_IN_REQUESTS',
      useFactory: () => {
        return new Counter({
          name: 'graph_in_requests',
          help: 'Total in GraphQL',
          labelNames: ['chainId', 'version'],
        });
      },
    },
  ],
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}

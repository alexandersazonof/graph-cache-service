import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

@Module({
  providers: [
    MetricsService,
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

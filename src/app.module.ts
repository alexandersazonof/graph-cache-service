import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { CacheModule } from './cache/cache.module';
import { GraphModule } from './graph/graph.module';
import { UtilsModule } from './utils/utils.module';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics/metrics.service';
import { AllExceptionsFilter } from './metrics/exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { Counter } from 'prom-client';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
    }),
    CacheModule,
    GraphModule,
    UtilsModule,
  ],
  controllers: [AppController],
  providers: [
    MetricsService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}

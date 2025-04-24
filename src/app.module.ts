import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { CacheModule } from './cache/cache.module';
import { GraphModule } from './graph/graph.module';
import { UtilsModule } from './utils/utils.module';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { AllExceptionsFilter } from './metrics/exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule,
    GraphModule,
    UtilsModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}

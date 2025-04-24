import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';
import { UtilsModule } from '../utils/utils.module';
import { CacheModule } from '../cache/cache.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsService } from "../metrics/metrics.service";
import { MetricsModule } from "../metrics/metrics.module";

@Module({
  providers: [GraphService],
  controllers: [GraphController],
  imports: [UtilsModule, CacheModule, MetricsModule],
})
export class GraphModule {}

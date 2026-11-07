import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisCacheService } from './redis-cache.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  providers: [CacheService, RedisCacheService],
  exports: [CacheService],
})
export class CacheModule {}

import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';

export type GraphSource = 'graph' | 'explorer' | 'custom';

const CHAIN_IDS = new Set([
  '1',
  '137',
  '324',
  '8453',
  '42161',
  '999',
  '42161-plasma',
  '8453-plasma',
]);
const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);

@Injectable()
export class MetricsService {
  constructor(
    @Inject('ERRORS_COUNTER') private readonly errorsCounter: Counter<string>,
    @Inject('REQUESTS_COUNTER')
    private readonly requestsCounter: Counter<string>,
    @Inject('TOO_MANY_REQUESTS_COUNTER')
    private readonly tooManyRequestsCounter: Counter<string>,
    @Inject('GRAPH_TOTAL_REQUESTS')
    private readonly totalRequests: Counter<string>,
    @Inject('GRAPH_TOTAL_CHAIN_REQUESTS')
    private readonly totalChainRequests: Counter<string>,
    @Inject('GRAPH_TOTAL_ERRORS')
    private readonly totalErrors: Counter<string>,
    @Inject('GRAPH_IN_REQUESTS')
    private readonly graphInRequests: Counter<string>,
    @Inject('GRAPH_CACHE_REQUESTS')
    private readonly cacheRequests: Counter<string>,
    @Inject('GRAPH_DEDUPLICATED_REQUESTS')
    private readonly deduplicatedRequests: Counter<string>,
    @Inject('HTTP_REQUEST_DURATION')
    private readonly httpRequestDuration: Histogram<string>,
    @Inject('GRAPH_UPSTREAM_DURATION')
    private readonly upstreamDuration: Histogram<string>,
    @Inject('REDIS_CACHE_ENABLED') private readonly redisEnabled: Gauge,
    @Inject('REDIS_CACHE_READY') private readonly redisReady: Gauge,
    @Inject('REDIS_CACHE_ERRORS') private readonly redisErrors: Counter<string>,
  ) {}

  incrementErrorCount() {
    this.errorsCounter.inc();
  }

  setRedisEnabled(enabled: boolean) {
    this.redisEnabled.set(enabled ? 1 : 0);
  }

  setRedisReady(ready: boolean) {
    this.redisReady.set(ready ? 1 : 0);
  }

  incrementRedisError(operation: 'connect' | 'get' | 'set') {
    this.redisErrors.inc({ operation });
  }

  incrementRequestCount(status: number, method: string) {
    this.requestsCounter.inc({ method: this.httpMethod(method), status });
    if (status === 429) {
      this.tooManyRequestsCounter.inc();
    }
  }

  recordCacheLookup(chainId: string, result: 'hit' | 'miss') {
    const chain = this.chainId(chainId);
    // Export both outcomes so the hit-rate query also works for a cold cache.
    this.cacheRequests.inc(
      { chainId: chain, result: result === 'hit' ? 'miss' : 'hit' },
      0,
    );
    this.cacheRequests.inc({ chainId: chain, result });
  }

  incrementDeduplicatedRequestCount(chainId: string) {
    this.deduplicatedRequests.inc({ chainId: this.chainId(chainId) });
  }

  startHttpRequestTimer(method: string) {
    const finish = this.httpRequestDuration.startTimer({
      method: this.httpMethod(method),
    });
    return (status: number) => finish({ status: String(status) });
  }

  startGraphUpstreamTimer(chainId: string, source: GraphSource) {
    const finish = this.upstreamDuration.startTimer({
      chainId: this.chainId(chainId),
      source,
    });
    return (outcome: 'success' | 'error') => finish({ outcome });
  }

  private chainId(chainId: string) {
    return CHAIN_IDS.has(chainId) ? chainId : 'unknown';
  }

  private httpMethod(method: string) {
    return HTTP_METHODS.has(method) ? method : 'OTHER';
  }

  incrementGraphRequestCount(chainId: string) {
    this.totalRequests.inc({ chainId });
  }

  incrementGraphChainRequestCount(chainId: string, version: string) {
    this.totalChainRequests.inc({ chainId, version });
  }

  incrementGraphErrorCount(chainId: string) {
    this.totalErrors.inc({ chainId });
  }

  incrementGraphInRequestCount(chainId: string, version: string) {
    this.graphInRequests.inc({ chainId, version });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Counter } from 'prom-client';

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
  ) {}

  incrementErrorCount() {
    this.errorsCounter.inc();
  }

  incrementRequestCount(status: number) {
    this.requestsCounter.inc();
    if (status === 429) {
      this.tooManyRequestsCounter.inc();
    }
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

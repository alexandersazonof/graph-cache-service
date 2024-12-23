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
}

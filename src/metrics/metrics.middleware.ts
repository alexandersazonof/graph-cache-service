import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Nest may mount this middleware with req.path === '/'; keep the original URL.
    const path = (req.originalUrl || req.path).split('?')[0];
    if (/^\/metrics\/?$/i.test(path)) {
      return next();
    }

    const finish = this.metricsService.startHttpRequestTimer(req.method);
    res.on('finish', () => {
      this.metricsService.incrementRequestCount(res.statusCode, req.method);
      finish(res.statusCode);
    });

    next();
  }
}

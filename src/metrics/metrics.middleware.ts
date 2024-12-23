import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (req.path === '/metrics') {
      return next();
    }

    res.on('finish', () => {
      this.metricsService.incrementRequestCount(res.statusCode);
    });

    next();
  }
}

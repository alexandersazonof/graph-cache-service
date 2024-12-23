import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NetworkUtils } from '../utils/network.utils';
import { CacheService } from '../cache/cache.service';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly networkUtils: NetworkUtils,
    private readonly cacheService: CacheService,
  ) {}

  async execute(
    chainId: number,
    version: string,
    request: { query: string; variables?: any },
  ): Promise<any> {
    this.logger.log(`Executing GraphQL query for chainId: ${chainId}`);
    const key = this.generateKey(chainId, version, JSON.stringify(request));
    const cacheResponse = this.cacheService.get(key);

    if (cacheResponse) {
      this.logger.log(`Returning cached response for chainId: ${chainId}`);
      return cacheResponse;
    }

    const link = `${this.networkUtils.getLinkByChainId(chainId)}/${version}`;
    const response = await this.executeWithRetry(link, request, 3);
    const ttl = this.cacheService.generateExpirationTime();
    this.cacheService.set(key, response, ttl);

    this.logger.log(`Returning response for chainId: ${chainId}`);
    return response;
  }

  private async executeWithRetry(
    link: string,
    request: { query: string; variables?: any },
    retryLimit: number,
    delay: number = 30000,
  ): Promise<any> {
    let attempts = 0;
    while (attempts < retryLimit) {
      try {
        return await this.executeToGraph(link, request);
      } catch (error) {
        this.logger.error(`Request failed: ${error.message}`);
        attempts++;
        if (attempts >= retryLimit) {
          if (error.response && error.response.status === 429) {
            this.logger.error(`After ${attempts} attempts, throw error`);
            throw new HttpException(
              'Too Many Requests',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          this.logger.error(
            `After ${attempts} attempts, throw error, data: ${JSON.stringify(request)}`,
          );
          throw new Error(
            `Failed to execute request after ${retryLimit} attempts`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async executeToGraph(
    link: string,
    request: { query: string; variables?: any },
  ): Promise<any> {
    try {
      const response = await axios.post(link, request, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.data.errors) {
        throw new Error(
          `GraphQL Errors: ${JSON.stringify(response.data.errors)}`,
        );
      }

      return response.data;
    } catch (error) {
      throw new Error(`Failed to execute GraphQL query: ${error.message}`);
    }
  }

  private generateKey(chainId: number, version: string, query: string): string {
    const key = `${chainId}-${version}-${query}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

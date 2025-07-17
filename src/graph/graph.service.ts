import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NetworkUtils } from '../utils/network.utils';
import { CacheService } from '../cache/cache.service';
import * as crypto from 'crypto';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import { DocumentNode, OperationDefinitionNode, parse } from 'graphql';

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);
  private readonly authKey = this.configService.get<string>('EXPLORER_API_KEY');
  private readonly maxAliasCount = this.configService.get<number>(
    'MAX_ALIAS_COUNT',
    5,
  );

  constructor(
    private readonly networkUtils: NetworkUtils,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async execute(
    chainId: string,
    version: string,
    request: { query: string; variables?: any },
  ): Promise<any> {
    this.metricsService.incrementGraphRequestCount(chainId);

    this.logger.log(`Executing GraphQL query for chainId: ${chainId}`);

    const aliasCount = this.countAliases(request.query);
    if (aliasCount > this.maxAliasCount) {
      this.logger.warn(
        `Too many aliases (${aliasCount}) in query, limit is ${this.maxAliasCount}, chainId: ${chainId}, query: ${request.query}`,
      );
      throw new HttpException(
        `Too many aliases (${aliasCount}), maximum allowed is ${this.maxAliasCount}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const key = this.generateKey(chainId, version, JSON.stringify(request));
    const cacheResponse = this.cacheService.get(key);

    if (cacheResponse) {
      this.logger.log(
        `Returning cached response for chainId: ${chainId} version: ${version}`,
      );
      return cacheResponse;
    }

    let link = `${this.networkUtils.getLinkByChainId(chainId)}/${version}`;
    let response;
    try {
      this.metricsService.incrementGraphChainRequestCount(chainId, version);
      this.metricsService.incrementGraphInRequestCount(chainId, version);
      response = await this.executeWithRetry(link, request, chainId, version);
    } catch (e) {
      // TODO enable after fix latest version
      // this.metricsService.incrementGraphErrorCount(chainId);
      // try {
      //   // #2 try to call latest version
      //   this.metricsService.incrementGraphChainRequestCount(chainId, 'latest');
      //   this.logger.log(
      //     `Try to call latest version instead of ${version} for chainId: ${chainId}`,
      //   );
      //   version = 'version/latest';
      //   link = `${this.networkUtils.getLinkByChainId(chainId)}/${version}`;
      //   response = await this.executeWithRetry(link, request, chainId, version);
      // } catch (e) {
        try {
          // #3 try to call explorer
          link = this.networkUtils.getExplorerLinkByChainId(chainId);
          if (link) {
            this.metricsService.incrementGraphChainRequestCount(
              chainId,
              'explorer',
            );
            this.logger.log(
              `Try to call explorer instead of ${version} for chainId: ${chainId}`,
            );
            response = await this.executeWithRetry(
              link,
              request,
              chainId,
              'explorer',
              true,
            );
          } else {
            this.logger.log(`No explorer link found for chainId: ${chainId}`);
            throw e;
          }
        } catch (e) {
          this.logger.log(
            `Error while executing explorer GraphQL query for chainId: ${chainId}`,
            e,
          );
          throw e;
        // }
      }
    }
    const ttl = this.cacheService.generateExpirationTime(request.query);
    this.cacheService.set(key, response, ttl);

    this.logger.log(
      `Returning response for chainId: ${chainId} version: ${version} ttl: ${ttl}`,
    );
    return response;
  }

  private async executeWithRetry(
    link: string,
    request: { query: string; variables?: any },
    chainId: string,
    version: string,
    useApiKey: boolean = false,
    retryLimit: number = 2,
    delay: number = 1000,
  ): Promise<any> {
    let attempts = 0;
    while (attempts < retryLimit) {
      try {
        return await this.executeToGraph(link, request, useApiKey);
      } catch (error) {
        this.logger.error(
          `Request failed chainId: ${chainId} version: ${version} \nmessage: ${error.message}`,
        );
        attempts++;
        if (attempts >= retryLimit) {
          if (error.status && error.status === 429) {
            this.logger.error(
              `After ${attempts} attempts, throw error because got 429 status`,
            );
            throw new HttpException(
              'Too Many Requests',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          this.logger.error(
            `After ${attempts} attempts, throw error, \n request: ${JSON.stringify(request)}`,
          );
          throw new Error(
            `Failed to execute request after ${retryLimit} attempts`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private countAliases(query: string): number {
    const ast: DocumentNode = parse(query);

    const op = ast.definitions.find(
      (def) => def.kind === 'OperationDefinition',
    ) as OperationDefinitionNode | undefined;

    if (!op) {
      throw new Error('No operation found in query.');
    }

    let aliasCount = 0;

    // Корневые селекторы
    for (const selection of op.selectionSet.selections) {
      if (selection.kind === 'Field') {
        aliasCount++;
      }
    }

    return aliasCount;
  }

  private async executeToGraph(
    link: string,
    request: { query: string; variables?: any },
    useApiKey: boolean = false,
  ): Promise<any> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (useApiKey) {
        headers['Authorization'] = `Bearer ${this.authKey}`;
      }

      const response = await axios.post(link, request, { headers });

      if (response.data.errors) {
        throw new Error(
          `GraphQL Errors: ${JSON.stringify(response.data.errors)}`,
        );
      }

      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        throw new HttpException(
          'Too Many Requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new Error(error.message);
    }
  }

  private generateKey(chainId: string, version: string, query: string): string {
    const key = `${chainId}-${version}-${query}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

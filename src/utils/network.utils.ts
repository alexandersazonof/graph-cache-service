import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NetworkUtils {
  private readonly ethUrl = this.configService.get<string>('ETH_URL');
  private readonly polygonUrl = this.configService.get<string>('POLYGON_URL');
  private readonly zkSyncUrl = this.configService.get<string>('ZKSYNC_URL');
  private readonly baseUrl = this.configService.get<string>('BASE_URL');
  private readonly arbitrumUrl = this.configService.get<string>('ARBITRUM_URL');
  private readonly arbitrumPlasmaUrl = this.configService.get<string>(
    'ARBITRUM_PLASMA_URL',
  );
  private readonly basePlasmaUrl =
    this.configService.get<string>('BASE_PLASMA_URL');

  private readonly ethExplorerUrl = this.configService.get<string>('ETH_EXPLORER_URL');
  private readonly polygonExplorerUrl = this.configService.get<string>('POLYGON_EXPLORER_URL');
  private readonly baseExplorerUrl = this.configService.get<string>('BASE_EXPLORER_URL');
  private readonly arbitrumExplorerUrl = this.configService.get<string>('ARBITRUM_EXPLORER_URL');
  private readonly zksyncExplorerUrl = this.configService.get<string>('ZKSYNC_EXPLORER_URL');

  constructor(private configService: ConfigService) {}

  getLinkByChainId(chainId: string) {
    switch (chainId) {
      case '1':
        return this.ethUrl;
      case '137':
        return this.polygonUrl;
      case '324':
        return this.zkSyncUrl;
      case '8453':
        return this.baseUrl;
      case '42161':
        return this.arbitrumUrl;
      case '42161-plasma':
        return this.arbitrumPlasmaUrl;
      case '8453-plasma':
        return this.basePlasmaUrl;
      default:
        throw new Error(`Unsupported chainId: ${chainId}`);
    }
  }

  getExplorerLinkByChainId(chainId: string) {
    switch (chainId) {
      case '1':
        return this.ethExplorerUrl;
      case '137':
        return this.polygonExplorerUrl;
      case '324':
        return this.zksyncExplorerUrl;
      case '8453':
        return this.baseExplorerUrl;
      case '42161':
        return this.arbitrumExplorerUrl;
      default:
        throw new Error(`Unsupported chainId: ${chainId}`);
    }
  }
}

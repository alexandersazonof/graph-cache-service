import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { GraphService } from './graph.service';

@Controller()
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post(':chainId/:version?')
  @HttpCode(200)
  async setCache(
    @Param('chainId') chainId: string,
    @Body() body: any,
    @Param('version') version?: string,
  ): Promise<string> {
    const resolvedVersion = version || 'version/latest';
    return await this.graphService.execute(chainId, resolvedVersion, body);
  }
}

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

### Cache and upstream settings

| Environment variable       | Default    | Description                                                                                                                                                                         |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CACHE_TTL`                | `7200000`  | Cache lifetime in milliseconds (2 hours). Balance queries retain their fixed 10-minute TTL.                                                                                         |
| `CACHE_MAX_ENTRIES`        | `1000`     | Maximum cached responses per process; least recently used entries are evicted first.                                                                                                |
| `CACHE_MAX_BYTES`          | `67108864` | Maximum combined UTF-8 size of cache keys and JSON payloads (64 MiB). This is a payload budget, not a total process memory limit. Oversized responses are returned without caching. |
| `GRAPH_REQUEST_TIMEOUT_MS` | `10000`    | Axios timeout in milliseconds for each upstream attempt, including retries and explorer fallback. Total request time can span multiple attempts.                                    |

These settings must be integers between 1 and 2147483647; invalid values prevent startup.
Expired cache entries are removed on access and every minute. Concurrent requests
with the same chain, version and serialized request body share one upstream
execution, including retries and fallback. Request sharing is local to each
process. By default, cached responses are also local to each process.

### Optional Redis cache

Redis is **disabled by default**. With `REDIS_ENABLED` unset or `false`, no Redis
client or connection is created, and the application uses its bounded in-memory
cache. Redis connection settings are ignored in this mode.

| Environment variable | Default           | Description                                                                                          |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `REDIS_ENABLED`      | `false`           | Set to `true` to use Redis as the shared response cache. Only `true` and `false` are accepted.       |
| `REDIS_URL`          | unset             | Required when enabled. Supports `redis://` and `rediss://` (TLS), credentials and a database number. |
| `REDIS_TIMEOUT_MS`   | `1000`            | Positive integer timeout for connecting and individual Redis commands, in milliseconds.              |
| `REDIS_KEY_PREFIX`   | `graph-cache:v1:` | Non-empty key namespace. Use a different prefix for each environment or application sharing Redis.   |

To enable Redis, configure the following environment variables and restart:

```dotenv
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
REDIS_TIMEOUT_MS=1000
REDIS_KEY_PREFIX=graph-cache:production:v1:
```

Responses are stored as JSON with the same millisecond TTL as the local cache,
including the balance-specific TTL. Healthy Redis reads and writes use Redis
without retaining a second copy in local memory. Connection or command failures
fall back to the bounded local cache; reconnects happen automatically. A missing
key in healthy Redis is treated as a miss, without serving an older local copy.
Unfulfilled commands are not queued or replayed after reconnection.

`CACHE_MAX_ENTRIES` and the total `CACHE_MAX_BYTES` budget apply to the local cache.
`CACHE_MAX_BYTES` also limits the size of an individual Redis entry, including its
unprefixed key. For Redis itself, configure a server-side memory limit and eviction
policy such as `allkeys-lru`; the application does not change server settings or
enforce a global Redis entry limit. Replicas can share cached responses, while
concurrent-request deduplication remains per process. GraphQL retries, source
selection and authorization are unchanged.

### Prometheus metrics

Metrics are exposed at `GET /metrics`.

Redis health for external monitoring is exposed as `redis_cache_enabled` (0/1),
`redis_cache_ready` (0/1), and `redis_cache_errors_total{operation="connect|get|set"}`.
Redis-disabled deployments report enabled=0 and ready=0; alerts must check enabled first.

| Metric                                    | Labels                         | Meaning                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph_cache_requests_total`              | `chainId`, `result`            | Every cache lookup: `hit` or `miss`. Requests waiting on an in-flight request are counted as misses. Invalid GraphQL rejected before lookup is excluded.                                                                      |
| `graph_deduplicated_requests_total`       | `chainId`                      | Misses that reuse an existing in-flight execution. This is a subset of cache misses.                                                                                                                                          |
| `http_request_duration_seconds`           | `method`, `status`             | Histogram of completed HTTP requests, including cache hits, retries, fallback and response delivery. `/metrics` scrapes are excluded.                                                                                         |
| `graph_upstream_request_duration_seconds` | `chainId`, `source`, `outcome` | Histogram for each actual upstream attempt. Sources are `graph`, `explorer` (fallback), and `custom` (primary custom infrastructure). Outcomes are `success` or `error`, including GraphQL errors. Retry delays are excluded. |

Histogram `_count` series also provide attempt counts and error rates. Source
labels describe the destination, independently of API key usage. No query text,
URL, cache key or user-provided version is added to the new metric labels.
Unknown chain IDs are grouped as `unknown`; nonstandard HTTP methods as `OTHER`.
Existing `requests_total` now includes the actual HTTP method and status labels.
Retry limits, delays, source selection, fallback order and authorization are unchanged.

Example PromQL queries (add your deployment's `job`/`instance` filters as needed):

Cache hit percentage by chain:

```promql
100 * sum by (chainId) (rate(graph_cache_requests_total{result="hit"}[5m]))
  / sum by (chainId) (rate(graph_cache_requests_total[5m]))
```

P95 client-facing POST duration in seconds, including retries and fallback:

```promql
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{method="POST"}[5m]))
)
```

P95 upstream attempt duration by chain and source:

```promql
histogram_quantile(0.95,
  sum by (le, chainId, source) (rate(graph_upstream_request_duration_seconds_bucket[5m]))
)
```

Actual upstream attempts per second by chain, source and outcome:

```promql
sum by (chainId, source, outcome) (
  rate(graph_upstream_request_duration_seconds_count[5m])
)
```

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

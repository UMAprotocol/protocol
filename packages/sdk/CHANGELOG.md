# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.4.1...@uma/sdk@0.5.0) (2021-09-28)

### Bug Fixes

- make unused variables an error in the typescript linter ([#3279](https://github.com/UMAprotocol/protocol/issues/3279)) ([1d26dfc](https://github.com/UMAprotocol/protocol/commit/1d26dfcd500cc4f84dc5672de0c8f9a7c5592e43))
- **api,sdk:** allow build to run with node by fixing imports ([#3244](https://github.com/UMAprotocol/protocol/issues/3244)) ([2f77290](https://github.com/UMAprotocol/protocol/commit/2f77290b5dc1b48f7fc99fdef46f08aee83786e5))

### Features

- **core:** add tasks to manage artifacts and deployments ([#3229](https://github.com/UMAprotocol/protocol/issues/3229)) ([15a8f31](https://github.com/UMAprotocol/protocol/commit/15a8f31e3d3ce0df9b68b03ae56f8df789ae481a))
- **sdk:** 1882 complete google datastore store integration and tests ([#3313](https://github.com/UMAprotocol/protocol/issues/3313)) ([4f15a5d](https://github.com/UMAprotocol/protocol/commit/4f15a5df68eb7f5c25f4ab78ed9acffd96e7c6b2))
- **sdk:** add frontend build process to sdk ([#3393](https://github.com/UMAprotocol/protocol/issues/3393)) ([1978e31](https://github.com/UMAprotocol/protocol/commit/1978e31dcc1f086f412b37627824edb1d7bd9412))

### Performance Improvements

- **api:** perform EMPs calls in batch ([#3371](https://github.com/UMAprotocol/protocol/issues/3371)) ([7c9c8f6](https://github.com/UMAprotocol/protocol/commit/7c9c8f68f9e924f089ec55f0f714655cdf88a9f7))

## [0.4.1](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.4.0...@uma/sdk@0.4.1) (2021-07-19)

**Note:** Version bump only for package @uma/sdk

# [0.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.3.0...@uma/sdk@0.4.0) (2021-07-15)

### Features

- **api:** 1445 add lsp state ingestion service ([#3231](https://github.com/UMAprotocol/protocol/issues/3231)) ([cc2f326](https://github.com/UMAprotocol/protocol/commit/cc2f326cc49d47abb11e69d6b97d54e937f19e7f))
- **core:** refactor core tests to no longer use truffle ([#3202](https://github.com/UMAprotocol/protocol/issues/3202)) ([349401a](https://github.com/UMAprotocol/protocol/commit/349401a869e89f9b5583d34c1f282407dca021ac))
- **sdk:** 1539 add lsp creator client and lsp client ([#3173](https://github.com/UMAprotocol/protocol/issues/3173)) ([e2fb7d6](https://github.com/UMAprotocol/protocol/commit/e2fb7d672b43c28428e18903f7ca4b217ed2a598))

# [0.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.2.0...@uma/sdk@0.3.0) (2021-07-07)

### Features

- **api:** 1531 add backfill collateral prices 1 month before app start ([#3170](https://github.com/UMAprotocol/protocol/issues/3170)) ([d246861](https://github.com/UMAprotocol/protocol/commit/d24686113222570a652a70179e091e332547ad26))
- **api:** add total and partial tvl calls ([#3090](https://github.com/UMAprotocol/protocol/issues/3090)) ([6267a9e](https://github.com/UMAprotocol/protocol/commit/6267a9e70f1f285787f4203769687fd10c70598d))
- **api:** add usd price conversions to synthetic prices ([#3153](https://github.com/UMAprotocol/protocol/issues/3153)) ([cb4abe3](https://github.com/UMAprotocol/protocol/commit/cb4abe363bb77f831767e45783d567f37dbc7992))

# [0.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.1.0...@uma/sdk@0.2.0) (2021-06-21)

### Features

- **api:** add historical price queries for collateral addresses ([#3079](https://github.com/UMAprotocol/protocol/issues/3079)) ([ce7fdb6](https://github.com/UMAprotocol/protocol/commit/ce7fdb650758fcc6dca622b2ff65903e03bb3f47))
- **sdk:** add erc20 client and table ([#3084](https://github.com/UMAprotocol/protocol/issues/3084)) ([f6745d2](https://github.com/UMAprotocol/protocol/commit/f6745d218b953df2214b0f027e6ce229edcff68c))
- **sdk:** add prices table using sorted map ([#3066](https://github.com/UMAprotocol/protocol/issues/3066)) ([3a04fe4](https://github.com/UMAprotocol/protocol/commit/3a04fe4cfeacbb905d8dd2f2ea71fcde80ff91ce))

# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.12.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.11.0...@uma/sdk@0.12.0) (2021-11-09)

### Bug Fixes

- use timestamps to calculate apy periods for more accuracy ([#3569](https://github.com/UMAprotocol/protocol/issues/3569)) ([75bb3b7](https://github.com/UMAprotocol/protocol/commit/75bb3b7dac2b18de7a0e30e1ec76c494ae7cb6c9))

### Features

- **api:** add ability to pull in Polygon contracts ([#3564](https://github.com/UMAprotocol/protocol/issues/3564)) ([e2d7dce](https://github.com/UMAprotocol/protocol/commit/e2d7dce3e157132e36a2bfdc3b81080dbf8a6cbe))

# [0.11.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.10.2...@uma/sdk@0.11.0) (2021-11-05)

### Bug Fixes

- **sdk:** fix next startblock for pooleventstate ([#3560](https://github.com/UMAprotocol/protocol/issues/3560)) ([e3ade22](https://github.com/UMAprotocol/protocol/commit/e3ade22a0c8682532714a75d710ad829453579a5))
- **sdk:** fix total pool size, remove pendingReserves ([#3568](https://github.com/UMAprotocol/protocol/issues/3568)) ([469969a](https://github.com/UMAprotocol/protocol/commit/469969a79f493695d3eca5d0a311859c24e77d4a))

- fix(sdk)!: fix pool removal preview calcs (#3567) ([ef6f326](https://github.com/UMAprotocol/protocol/commit/ef6f3267f4f66e943ffa367919c2e6797b5cd8eb)), closes [#3567](https://github.com/UMAprotocol/protocol/issues/3567)

### Features

- **sdk:** add tx receipt decoding events to bridgepool client ([#3565](https://github.com/UMAprotocol/protocol/issues/3565)) ([fc46a59](https://github.com/UMAprotocol/protocol/commit/fc46a59dc5f62f5423972d151efc06be2f62476b))

### BREAKING CHANGES

- previewRemoval function api is changed to accept user object

Signed-off-by: David <david@umaproject.org>

## [0.10.2](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.10.1...@uma/sdk@0.10.2) (2021-11-02)

### Bug Fixes

- update user and pool after transaction confirms ([#3543](https://github.com/UMAprotocol/protocol/issues/3543)) ([cc382b3](https://github.com/UMAprotocol/protocol/commit/cc382b3ea1a44624951884f65c630aeb87a11004))

## [0.10.1](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.10.0...@uma/sdk@0.10.1) (2021-10-29)

### Bug Fixes

- **GasEstimator:** protocol upgrade for EIP1559 ([#3306](https://github.com/UMAprotocol/protocol/issues/3306)) ([8245391](https://github.com/UMAprotocol/protocol/commit/8245391ee07dca37be3c52a9a9ba47ed4d63f6f7))

# [0.10.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.9.0...@uma/sdk@0.10.0) (2021-10-27)

### Bug Fixes

- **sdk:** fix chainid type to bignumber ([#3487](https://github.com/UMAprotocol/protocol/issues/3487)) ([1e3cc70](https://github.com/UMAprotocol/protocol/commit/1e3cc709e098f862dcc812d00dfba67a8d99360b))

### Features

- **sdk:** add across bridge pool read only client ([#3493](https://github.com/UMAprotocol/protocol/issues/3493)) ([043f7c2](https://github.com/UMAprotocol/protocol/commit/043f7c2083a2cff89c3dcee93dc51d8c8df018d6))
- **sdk:** add bridge pool contract client ([#3462](https://github.com/UMAprotocol/protocol/issues/3462)) ([32238f9](https://github.com/UMAprotocol/protocol/commit/32238f9c6160511588527e83afdc0a747fc5cbca))
- **sdk:** add estimated apy calculation to bridgepool read client ([#3502](https://github.com/UMAprotocol/protocol/issues/3502)) ([80cf357](https://github.com/UMAprotocol/protocol/commit/80cf357b0a398fd4b6b738605fcffab732b2f252))

# [0.9.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.8.0...@uma/sdk@0.9.0) (2021-10-19)

### Bug Fixes

- **api:** specify explicitly the npm datastore version ([#3476](https://github.com/UMAprotocol/protocol/issues/3476)) ([b588e83](https://github.com/UMAprotocol/protocol/commit/b588e83ca548a2a0d59b36f02ec9800afce28dec))

### Features

- **sdk:** add across gas fee estimations ([#3471](https://github.com/UMAprotocol/protocol/issues/3471)) ([6c205c3](https://github.com/UMAprotocol/protocol/commit/6c205c31176bd7c5aa7cc4ce2c9f0fa10d1ec9d0))

# [0.8.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.7.0...@uma/sdk@0.8.0) (2021-10-08)

### Features

- **api:** use Google Datastore as store provider for tables ([#3442](https://github.com/UMAprotocol/protocol/issues/3442)) ([ce68075](https://github.com/UMAprotocol/protocol/commit/ce6807591d478957172902a0e1bd727bb11b23a0))

# [0.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.6.0...@uma/sdk@0.7.0) (2021-10-01)

### Bug Fixes

- **sdk:** edit prepare process for release ([#3419](https://github.com/UMAprotocol/protocol/issues/3419)) ([6470d4d](https://github.com/UMAprotocol/protocol/commit/6470d4d3137094fe2d0ba3b44820697438f0202e))

### Features

- **sdk:** add bridge deposit box client ([#3414](https://github.com/UMAprotocol/protocol/issues/3414)) ([b253e27](https://github.com/UMAprotocol/protocol/commit/b253e2793bacd65b19934a0fa6f2ee23cda8ff02))

# [0.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.5.0...@uma/sdk@0.6.0) (2021-10-01)

### Features

- **sdk:** add direct port of fee calculators and add docs ([#3410](https://github.com/UMAprotocol/protocol/issues/3410)) ([7c21f75](https://github.com/UMAprotocol/protocol/commit/7c21f75d681f0e9a7dbcdc31dcfaa875d16cf9be))

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

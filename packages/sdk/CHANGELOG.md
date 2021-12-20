# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.17.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.16.1...@uma/sdk@0.17.0) (2021-12-17)

### Bug Fixes

- **sdk:** fix pool withdraw validation ([#3693](https://github.com/UMAprotocol/protocol/issues/3693)) ([c9fecd5](https://github.com/UMAprotocol/protocol/commit/c9fecd53c3cb65b91ad058ff3a9af2d72e20d9bb))

### Features

- **across-bots:** add profitability module to only relay profitable relays ([#3656](https://github.com/UMAprotocol/protocol/issues/3656)) ([f9fb117](https://github.com/UMAprotocol/protocol/commit/f9fb1178894bb1b39b2969bd26ba435979059a19))
- **sdk:** add detailed gas deposit fees for across ([#3713](https://github.com/UMAprotocol/protocol/issues/3713)) ([eb158a4](https://github.com/UMAprotocol/protocol/commit/eb158a49a16ce1061b676544ac238a92646e534a))

- feat(sdk)!: add improved gas fee function (#3700) ([4eae69d](https://github.com/UMAprotocol/protocol/commit/4eae69d9814a220987b3011dd9d45b88e3962fbb)), closes [#3700](https://github.com/UMAprotocol/protocol/issues/3700)

### BREAKING CHANGES

- calls to previous gas estimator must migrate to new interface
- improve(sdk): improve gas fee type, docs and e2e test

## [0.16.1](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.16.0...@uma/sdk@0.16.1) (2021-12-13)

### Bug Fixes

- **sdk:** fix rate model address for uma ([#3691](https://github.com/UMAprotocol/protocol/issues/3691)) ([4492971](https://github.com/UMAprotocol/protocol/commit/4492971554f4deef3c400ac0c023d09d0fb8e37a))

# [0.16.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.14.0...@uma/sdk@0.16.0) (2021-12-07)

### Features

- **sdk:** ability to send funds from Ethereum to Boba ([#3646](https://github.com/UMAprotocol/protocol/issues/3646)) ([543cf74](https://github.com/UMAprotocol/protocol/commit/543cf745858b8b75f7034ca91d701c2f7c5045b7))
- **sdk:** add timestamp search for lp fee pct calculation ([#3665](https://github.com/UMAprotocol/protocol/issues/3665)) ([3db71fe](https://github.com/UMAprotocol/protocol/commit/3db71fe7aef3a97e8707592a0129ed157ba2802a))

# [0.15.0](https://amateima.github.com/UMAprotocol/protocol/compare/@uma/sdk@0.14.0...@uma/sdk@0.15.0) (2021-12-07)

### Features

- **sdk:** ability to send funds from Ethereum to Boba ([#3646](https://amateima.github.com/UMAprotocol/protocol/issues/3646)) ([543cf74](https://amateima.github.com/UMAprotocol/protocol/commit/543cf745858b8b75f7034ca91d701c2f7c5045b7))

# [0.14.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.13.0...@uma/sdk@0.14.0) (2021-12-06)

### Features

- **sdk:** add L1 -> L2 Optimism Bridge Client ([#3623](https://github.com/UMAprotocol/protocol/issues/3623)) ([732ff78](https://github.com/UMAprotocol/protocol/commit/732ff78ad38e2b17affb51195602b61864b87d40))
- **sdk:** add projected apr calculation ([#3655](https://github.com/UMAprotocol/protocol/issues/3655)) ([0796f8b](https://github.com/UMAprotocol/protocol/commit/0796f8b002e32bd9ce5ec6319d76ca785c844dd9))

# [0.13.0](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.12.3...@uma/sdk@0.13.0) (2021-11-18)

### Bug Fixes

- **sdk:** do not pre-populate transactions, allow overrides ([#3619](https://github.com/UMAprotocol/protocol/issues/3619)) ([fc07785](https://github.com/UMAprotocol/protocol/commit/fc07785f6ce09bd8417257b6a255c424f3ec4708))
- **sdk:** pass empty object instead of undefined to tx calls to fix call errors ([#3621](https://github.com/UMAprotocol/protocol/issues/3621)) ([9d4ef82](https://github.com/UMAprotocol/protocol/commit/9d4ef8218f28f3978a3d21509db791b775212929))

### Features

- **sdk:** add rate models to constants ([#3613](https://github.com/UMAprotocol/protocol/issues/3613)) ([20495c3](https://github.com/UMAprotocol/protocol/commit/20495c36083b4fe9968cb95541d9d33200ca0fa4))

## [0.12.3](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.12.2...@uma/sdk@0.12.3) (2021-11-12)

### Bug Fixes

- **sdk:** fix typo in PoolClient ([#3600](https://github.com/UMAprotocol/protocol/issues/3600)) ([d59fe26](https://github.com/UMAprotocol/protocol/commit/d59fe266c9223759f6a21825f456e485bac93867))

## [0.12.2](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.12.1...@uma/sdk@0.12.2) (2021-11-11)

### Bug Fixes

- **sdk:** add pool utilization ([#3597](https://github.com/UMAprotocol/protocol/issues/3597)) ([f34d59c](https://github.com/UMAprotocol/protocol/commit/f34d59cd183bdfa5baab15a6e788f7c087ba3e33))

## [0.12.1](https://github.com/UMAprotocol/protocol/compare/@uma/sdk@0.12.0...@uma/sdk@0.12.1) (2021-11-09)

### Bug Fixes

- **sdk:** fix across pool size calculation regression ([#3590](https://github.com/UMAprotocol/protocol/issues/3590)) ([8e6cb1d](https://github.com/UMAprotocol/protocol/commit/8e6cb1daed174b5c8f435cd616c6b7fed1864a6a))

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

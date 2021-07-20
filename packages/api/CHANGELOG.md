# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/api@0.3.0...@uma/api@0.4.0) (2021-07-15)

### Bug Fixes

- **api:** ignore tvm calculations if no collateral is locked in contract ([#3227](https://github.com/UMAprotocol/protocol/issues/3227)) ([e8bd071](https://github.com/UMAprotocol/protocol/commit/e8bd07167eb35028fcd9d5a0630c83818b02ccc4))

### Features

- **api:** 0x api client to fetch prices based on token name ([#3203](https://github.com/UMAprotocol/protocol/issues/3203)) ([0cceb70](https://github.com/UMAprotocol/protocol/commit/0cceb707f01e08c278c7d7b496f59cb04787e30d))
- **api:** 1445 add lsp state ingestion service ([#3231](https://github.com/UMAprotocol/protocol/issues/3231)) ([cc2f326](https://github.com/UMAprotocol/protocol/commit/cc2f326cc49d47abb11e69d6b97d54e937f19e7f))
- **api:** 1464 backfill tvl history ([#3172](https://github.com/UMAprotocol/protocol/issues/3172)) ([288ea9f](https://github.com/UMAprotocol/protocol/commit/288ea9f6c2acf3dee2d11806edb4581de984586c))
- **api:** 1523 add market prices to emp state and call to list known market prices ([#3206](https://github.com/UMAprotocol/protocol/issues/3206)) ([254d8da](https://github.com/UMAprotocol/protocol/commit/254d8daff9748cd6661ba589ebbd6b9e2e2f119f))
- **api:** 1680 cache global tvl rather than compute it for every query ([#3223](https://github.com/UMAprotocol/protocol/issues/3223)) ([1e215f8](https://github.com/UMAprotocol/protocol/commit/1e215f81824358d0d3b0c54f587c59314d2f47f8))
- **api:** 1728 add profiling that can be disabled through env ([#3233](https://github.com/UMAprotocol/protocol/issues/3233)) ([c5bf79c](https://github.com/UMAprotocol/protocol/commit/c5bf79c73d3b6fc01904b54837b9c944d9480aa6))
- **api:** add global tvl history and api calls ([#3224](https://github.com/UMAprotocol/protocol/issues/3224)) ([0d97d7e](https://github.com/UMAprotocol/protocol/commit/0d97d7e3a069fbf919879cfcfc2e3196e1adeaf0))
- **api:** add historical market prices and expose in api ([#3218](https://github.com/UMAprotocol/protocol/issues/3218)) ([db861ea](https://github.com/UMAprotocol/protocol/commit/db861ea1f8d064bcfd1129ab6f6a9a3bd9cb09ed))
- **api:** add symbol names and identifier price to emp state ([#3205](https://github.com/UMAprotocol/protocol/issues/3205)) ([51c013e](https://github.com/UMAprotocol/protocol/commit/51c013eb1067aa7ca625f33740a62d1e7ce0eb1b))

# [0.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/api@0.2.0...@uma/api@0.3.0) (2021-07-07)

### Features

- **api:** 1405 add tvm calculations per emp ([#3122](https://github.com/UMAprotocol/protocol/issues/3122)) ([0d234d3](https://github.com/UMAprotocol/protocol/commit/0d234d3090efa9a663e204c797dc18bc537dae5f))
- **api:** 1531 add backfill collateral prices 1 month before app start ([#3170](https://github.com/UMAprotocol/protocol/issues/3170)) ([d246861](https://github.com/UMAprotocol/protocol/commit/d24686113222570a652a70179e091e332547ad26))
- **api:** add ability to obtain a time series of tvl ([#3091](https://github.com/UMAprotocol/protocol/issues/3091)) ([6698e63](https://github.com/UMAprotocol/protocol/commit/6698e636d9589756770ac13f142cc45c883f43cc))
- **api:** add total and partial tvl calls ([#3090](https://github.com/UMAprotocol/protocol/issues/3090)) ([6267a9e](https://github.com/UMAprotocol/protocol/commit/6267a9e70f1f285787f4203769687fd10c70598d))
- **api:** add usd price conversions to synthetic prices ([#3153](https://github.com/UMAprotocol/protocol/issues/3153)) ([cb4abe3](https://github.com/UMAprotocol/protocol/commit/cb4abe363bb77f831767e45783d567f37dbc7992))

# [0.2.0](https://github.com/UMAprotocol/protocol/compare/api@0.1.0...api@0.2.0) (2021-06-21)

### Features

- **api:** 932 record historical synthetic prices based on emp latest price ([#3108](https://github.com/UMAprotocol/protocol/issues/3108)) ([078e694](https://github.com/UMAprotocol/protocol/commit/078e694542ceb1deebc276014ee9d1cb140770e7))
- **api:** add historical price queries for collateral addresses ([#3079](https://github.com/UMAprotocol/protocol/issues/3079)) ([ce7fdb6](https://github.com/UMAprotocol/protocol/commit/ce7fdb650758fcc6dca622b2ff65903e03bb3f47))
- **api:** add latest prices for collateral addresses ([#3067](https://github.com/UMAprotocol/protocol/issues/3067)) ([63ce351](https://github.com/UMAprotocol/protocol/commit/63ce351e87d444c6700c716c9e89c045462acec2))
- **api:** add synthetic prices per emp ([#3107](https://github.com/UMAprotocol/protocol/issues/3107)) ([243699b](https://github.com/UMAprotocol/protocol/commit/243699ba9d778092ff03466e648169344210b259))
- **api:** add token names and decimals to returned emp state ([#3085](https://github.com/UMAprotocol/protocol/issues/3085)) ([740c264](https://github.com/UMAprotocol/protocol/commit/740c2640d77c5a35e8f4b830c76a6811436c1b08))
- **api:** add tvl endpoints for each contract ([#3087](https://github.com/UMAprotocol/protocol/issues/3087)) ([2cc372a](https://github.com/UMAprotocol/protocol/commit/2cc372a686e9d927ce0ff8758f5789b52565bc73))

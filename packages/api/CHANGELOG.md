# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.5.1](https://github.com/UMAprotocol/protocol/compare/@uma/api@0.5.0...@uma/api@0.5.1) (2021-10-01)

### Bug Fixes

- **api:** discovery events and block interval check ([#3394](https://github.com/UMAprotocol/protocol/issues/3394)) ([b384689](https://github.com/UMAprotocol/protocol/commit/b384689e6925b1c9c6c34fbc42c5cfdd83ea8d18))

# [0.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/api@0.4.1...@uma/api@0.5.0) (2021-09-28)

### Bug Fixes

- **api:** 1942 add price converted gcr field to emp state ([#3300](https://github.com/UMAprotocol/protocol/issues/3300)) ([35ef2d4](https://github.com/UMAprotocol/protocol/commit/35ef2d4b11f78a0393182490b0c812408e7a6fe7))
- **api:** add retry options to web3 websocket ([#3367](https://github.com/UMAprotocol/protocol/issues/3367)) ([ccfbf07](https://github.com/UMAprotocol/protocol/commit/ccfbf07f9061a12cd97ad8f6b2a8fb7ea8af05b0))
- **api:** better state updating loops and timeouts ([#3370](https://github.com/UMAprotocol/protocol/issues/3370)) ([06094f2](https://github.com/UMAprotocol/protocol/commit/06094f2b2c9defbcc332da4de64e2bf1a6ed91fa))
- **api:** fix event queries for discovering contracts ([#3310](https://github.com/UMAprotocol/protocol/issues/3310)) ([7363e42](https://github.com/UMAprotocol/protocol/commit/7363e4276a514eba4d0bd5c717178bf7507e32a2))
- **api:** give lsp actions 0 tvm call, and throw errs on tvm history ([#3294](https://github.com/UMAprotocol/protocol/issues/3294)) ([c09e1e9](https://github.com/UMAprotocol/protocol/commit/c09e1e91488af721d07876eeaa0896307a1abb90))
- **api:** remove block events and update on timer ([#3347](https://github.com/UMAprotocol/protocol/issues/3347)) ([7988323](https://github.com/UMAprotocol/protocol/commit/7988323bf70d0c10e01bbb2714c1997c312fd651))
- **api:** use token decimals when looking up market price ([#3304](https://github.com/UMAprotocol/protocol/issues/3304)) ([2b05e2c](https://github.com/UMAprotocol/protocol/commit/2b05e2c7853fbd0c360b3c202811bf7db9ff4b6f))
- make unused variables an error in the typescript linter ([#3279](https://github.com/UMAprotocol/protocol/issues/3279)) ([1d26dfc](https://github.com/UMAprotocol/protocol/commit/1d26dfcd500cc4f84dc5672de0c8f9a7c5592e43))
- **api,sdk:** allow build to run with node by fixing imports ([#3244](https://github.com/UMAprotocol/protocol/issues/3244)) ([2f77290](https://github.com/UMAprotocol/protocol/commit/2f77290b5dc1b48f7fc99fdef46f08aee83786e5))

### Features

- **api:** 1490 add lsp tvl calculations, per contract, totals and history ([#3251](https://github.com/UMAprotocol/protocol/issues/3251)) ([88d5b84](https://github.com/UMAprotocol/protocol/commit/88d5b84a2374ca728be2d73eb715ea8d4dacf319))
- **api:** 1828 start global routes, adding tvl ([#3252](https://github.com/UMAprotocol/protocol/issues/3252)) ([1aa7527](https://github.com/UMAprotocol/protocol/commit/1aa75273d92ef4e3e1a2525e7213dcf37a2ce8ff))
- **api:** 1837 global tvl history, various global utility calls ([#3261](https://github.com/UMAprotocol/protocol/issues/3261)) ([7ffb0d6](https://github.com/UMAprotocol/protocol/commit/7ffb0d63720d5374946d11bc8000b378dfcff7a4))
- **api:** 1884 add additional global utility calls ([#3288](https://github.com/UMAprotocol/protocol/issues/3288)) ([ee7cba5](https://github.com/UMAprotocol/protocol/commit/ee7cba5bd8d0c2c5af14a10db0ea2ea53b2d3d09))
- **api:** add ability to specify multiple LSP creator addresses ([#3253](https://github.com/UMAprotocol/protocol/issues/3253)) ([817b201](https://github.com/UMAprotocol/protocol/commit/817b2019d9f42843547a1b1a6f57ff8fbb494c03))
- **api:** add lsp tvm by copying in tvl as the source ([#3303](https://github.com/UMAprotocol/protocol/issues/3303)) ([d8dcf58](https://github.com/UMAprotocol/protocol/commit/d8dcf58ccde806464b91fce02d393c65f3033101))
- **api:** add pairName to lsp state ([#3291](https://github.com/UMAprotocol/protocol/issues/3291)) ([56c9df7](https://github.com/UMAprotocol/protocol/commit/56c9df7c774855d2986374145e56a66a9b4f6b65))
- **api:** add stripped down lsp api app version to optimize startup time for testing lsp ([#3372](https://github.com/UMAprotocol/protocol/issues/3372)) ([53b9171](https://github.com/UMAprotocol/protocol/commit/53b91711e3d5fb8ec54255dc444ff21e23dfeadc))
- **api:** allow pairName optionally if contract supports it ([#3295](https://github.com/UMAprotocol/protocol/issues/3295)) ([c342876](https://github.com/UMAprotocol/protocol/commit/c34287615237a8d2bd86107198d0f294061dc251))
- **api:** expose various lsp state calls and refactor api slightly ([#3245](https://github.com/UMAprotocol/protocol/issues/3245)) ([fa9e5f0](https://github.com/UMAprotocol/protocol/commit/fa9e5f01452877a3619cd0b6424159780b7472d0))
- **core:** add tasks to manage artifacts and deployments ([#3229](https://github.com/UMAprotocol/protocol/issues/3229)) ([15a8f31](https://github.com/UMAprotocol/protocol/commit/15a8f31e3d3ce0df9b68b03ae56f8df789ae481a))
- **financial-templates-lib:** convert src to typescript ([#3315](https://github.com/UMAprotocol/protocol/issues/3315)) ([3955d80](https://github.com/UMAprotocol/protocol/commit/3955d80038df1c54663a59b44d6e23bd09c7dcdc))
- **sdk:** add frontend build process to sdk ([#3393](https://github.com/UMAprotocol/protocol/issues/3393)) ([1978e31](https://github.com/UMAprotocol/protocol/commit/1978e31dcc1f086f412b37627824edb1d7bd9412))

### Performance Improvements

- **api:** perform EMPs calls in batch ([#3371](https://github.com/UMAprotocol/protocol/issues/3371)) ([7c9c8f6](https://github.com/UMAprotocol/protocol/commit/7c9c8f68f9e924f089ec55f0f714655cdf88a9f7))

## [0.4.1](https://github.com/UMAprotocol/protocol/compare/@uma/api@0.4.0...@uma/api@0.4.1) (2021-07-19)

### Bug Fixes

- **api:** fix tvl showing 0 ([#3238](https://github.com/UMAprotocol/protocol/issues/3238)) ([e9c8286](https://github.com/UMAprotocol/protocol/commit/e9c82860146b2fac987ffffcd8f2f21a8deef114))

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

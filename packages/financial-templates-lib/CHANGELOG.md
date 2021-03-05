# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@2.0.0...@uma/financial-templates-lib@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/financial-templates-lib

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@1.2.0...@uma/financial-templates-lib@2.0.0) (2021-02-26)

### Bug Fixes

- **bots:** Add feature to denominate synthetic price by another price feed + remove noisy BasketSpreadPriceFeed logs ([#2385](https://github.com/UMAprotocol/protocol/issues/2385)) ([cf7ddbb](https://github.com/UMAprotocol/protocol/commit/cf7ddbbbf052b014547a2af3e5d030014b843dd2))
- **default-price-feed-config:** specify pool decimals ([#2410](https://github.com/UMAprotocol/protocol/issues/2410)) ([d2db2d9](https://github.com/UMAprotocol/protocol/commit/d2db2d9cfff412f296aad36b14d9085d97896261))
- **financial-templates-lib:** fix domination finance feed decimals ([#2456](https://github.com/UMAprotocol/protocol/issues/2456)) ([383a05b](https://github.com/UMAprotocol/protocol/commit/383a05b22df03041be1cd5a71c9b71b3343fdaa2))
- **gas-estimator:** Prevent float gas prices ([#2509](https://github.com/UMAprotocol/protocol/issues/2509)) ([ac96ad1](https://github.com/UMAprotocol/protocol/commit/ac96ad14c7c3bb255f113855c11acc4377197dba))
- **jsontransport:** refactor and simplify transport ([#2506](https://github.com/UMAprotocol/protocol/issues/2506)) ([9a42531](https://github.com/UMAprotocol/protocol/commit/9a42531e8f3a84af92e70e37ccbaab1079d23abb))
- **uniswap-pf:** fixes a low volume bug in the uniswap price feed ([#2465](https://github.com/UMAprotocol/protocol/issues/2465)) ([cf2570e](https://github.com/UMAprotocol/protocol/commit/cf2570eccb377cadd4b68878192b21301e01be76))

### Features

- **2291:** set higher fromBlock for EMP client, and getFromBlock function for override ([#2360](https://github.com/UMAprotocol/protocol/issues/2360)) ([cb44b67](https://github.com/UMAprotocol/protocol/commit/cb44b67829c5887b10214405db00c19a91b89616))
- **bot-infrastructure:** add a generic DSProxy client ([#2559](https://github.com/UMAprotocol/protocol/issues/2559)) ([b275463](https://github.com/UMAprotocol/protocol/commit/b275463c0bfe2c3a45a5c049534b5acc3df58688))
- **bot-tests:** generalize muli-version testing ([#2448](https://github.com/UMAprotocol/protocol/issues/2448)) ([95fb302](https://github.com/UMAprotocol/protocol/commit/95fb302f5b370658adced9cf23c3f897fe00d7d5))
- **default-price-feed:** add TraderMadePriceFeed ([#2479](https://github.com/UMAprotocol/protocol/issues/2479)) ([71515a9](https://github.com/UMAprotocol/protocol/commit/71515a915c9d796014295c18ebd6300229f24364))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **financial-templates:** adds a new price feed for the DefiPulseTotalTVL synthetic tokens ([#2346](https://github.com/UMAprotocol/protocol/issues/2346)) ([71a6cfb](https://github.com/UMAprotocol/protocol/commit/71a6cfb14e9e55aa5c15a1673a5a04cdf6262c5a))
- **financial-templates-lib:** add `DominationFinancePriceFeed` for BTCDOM, ALTDOM (UMIP-21) ([#2379](https://github.com/UMAprotocol/protocol/issues/2379)) ([e14cc7b](https://github.com/UMAprotocol/protocol/commit/e14cc7b361a008de713c31d15978b147ba5b31e1)), closes [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378)
- **financial-templates-lib:** add a new price feed config for XAUPERL ([#2582](https://github.com/UMAprotocol/protocol/issues/2582)) ([0a5fbf6](https://github.com/UMAprotocol/protocol/commit/0a5fbf66252d46a4cf240e8ca9bee548c9bb30e3))
- **financial-templates-lib:** add Badger Sett default feeds ([#2576](https://github.com/UMAprotocol/protocol/issues/2576)) ([ca6e348](https://github.com/UMAprotocol/protocol/commit/ca6e3488e81e311187fd792ab54673568cd12c36))
- **financial-templates-lib:** add BlockFinder ([#2512](https://github.com/UMAprotocol/protocol/issues/2512)) ([6afefb6](https://github.com/UMAprotocol/protocol/commit/6afefb62598767eeec92a0249baf726f246239aa))
- **financial-templates-lib:** add LPPriceFeed ([#2575](https://github.com/UMAprotocol/protocol/issues/2575)) ([51a5dc5](https://github.com/UMAprotocol/protocol/commit/51a5dc561334c588e47a5b3eef36cfd00651e45b))
- **financial-templates-lib:** add Multiline support to ExpressionPriceFeed ([#2540](https://github.com/UMAprotocol/protocol/issues/2540)) ([bc5cca4](https://github.com/UMAprotocol/protocol/commit/bc5cca494d2505ff039df792adc78d2c7b8fc20e))
- **financial-templates-lib:** add price feed for yearn-style vaults ([#2542](https://github.com/UMAprotocol/protocol/issues/2542)) ([9d62c32](https://github.com/UMAprotocol/protocol/commit/9d62c32958a36773cfbb29daef993e3bf3dd4f3f))
- **financial-templates-lib:** make getHistoricalPrice async ([#2493](https://github.com/UMAprotocol/protocol/issues/2493)) ([c91e11b](https://github.com/UMAprotocol/protocol/commit/c91e11bad264509efd4ef98044e448e6e5b8b5f0))
- **monitor:** add perp support to monitor ([#2475](https://github.com/UMAprotocol/protocol/issues/2475)) ([b24bae1](https://github.com/UMAprotocol/protocol/commit/b24bae1fc3aabb6b163043447dd9c5baa1d156b8))
- **optimistic-oracle-keeper:** Add functionality to propose prices for price requests ([#2505](https://github.com/UMAprotocol/protocol/issues/2505)) ([cc71ea5](https://github.com/UMAprotocol/protocol/commit/cc71ea56ef6fd944232f9e8f6a7e190ce2ab250d))
- **optimistic-oracle-keeper:** Add OptimisticOracleClient stub code ([#2330](https://github.com/UMAprotocol/protocol/issues/2330)) ([03173e2](https://github.com/UMAprotocol/protocol/commit/03173e2a0abe2f2ee4adfc9e5879df1e5ac82cf7))
- **optimistic-oracle-proposer:** Add dispute logic ([#2546](https://github.com/UMAprotocol/protocol/issues/2546)) ([8ef696e](https://github.com/UMAprotocol/protocol/commit/8ef696e2b02744a820893a3c646e47496488bdfd))
- **optimistic-oracle-proposer:** Can settle proposals and disputes ([#2569](https://github.com/UMAprotocol/protocol/issues/2569)) ([43a5b63](https://github.com/UMAprotocol/protocol/commit/43a5b637291c6352fb39c969a9cb13f73c34b65d))
- **price-feeds:** add ExpressionPriceFeed ([#2513](https://github.com/UMAprotocol/protocol/issues/2513)) ([e882b58](https://github.com/UMAprotocol/protocol/commit/e882b58597157085fc6e8a1b1ed66847325dbda9))
- **price-feeds:** adds CoinMarketCapPriceFeed & CoinGeckoPriceFeed for querying DAI:PHP & PHP:DAI price ([#2480](https://github.com/UMAprotocol/protocol/issues/2480)) ([f0991db](https://github.com/UMAprotocol/protocol/commit/f0991dbd00de02f3f822f30e8eb50eb61c0a7817))
- **pricefeeds:** Add COMPUSDC-APR-MAR28/USDC ([#2537](https://github.com/UMAprotocol/protocol/issues/2537)) ([46f0066](https://github.com/UMAprotocol/protocol/commit/46f00664c684e0cc89b40ca324be3aee6397d2db))
- **serverless:** add timeout delay to serverless spoke calls ([#2393](https://github.com/UMAprotocol/protocol/issues/2393)) ([68040c5](https://github.com/UMAprotocol/protocol/commit/68040c52c7aaff09223bc5b83e04ef8f2cc45b71))
- **trader:** start trader package with typescript support ([#2484](https://github.com/UMAprotocol/protocol/issues/2484)) ([9fcc512](https://github.com/UMAprotocol/protocol/commit/9fcc5128fe3d684f4a87e2efa3d2e49934b96766))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@1.1.0...@uma/financial-templates-lib@1.2.0) (2020-11-23)

### Features

- **developer-mining:** calculate contract TVL using bot's pricefeed and collateral value ([#2150](https://github.com/UMAprotocol/protocol/issues/2150)) ([99bb94b](https://github.com/UMAprotocol/protocol/commit/99bb94b0a481307937e6b4bccd3e42fcc873617e))
- **emp:** financial product library to apply price transformation ([#2185](https://github.com/UMAprotocol/protocol/issues/2185)) ([5a7e2ec](https://github.com/UMAprotocol/protocol/commit/5a7e2ec25c5ecbc09397284839a553fee9d5636d))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@1.0.0...@uma/financial-templates-lib@1.1.0) (2020-10-05)

### Features

- **emp:** add trimExcess function to send excess tokens ([#1975](https://github.com/UMAprotocol/protocol/issues/1975)) ([658f4d9](https://github.com/UMAprotocol/protocol/commit/658f4d90cff9ece8b05a2922dcb0f78e9b62c80d))

# 1.0.0 (2020-09-15)

Initial Release!

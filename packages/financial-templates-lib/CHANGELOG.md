# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@2.2.0...@uma/financial-templates-lib@2.3.0) (2021-05-20)

### Bug Fixes

- **financial-templates-lib:** fix issues in test that was not being run by ci ([#2979](https://github.com/UMAprotocol/protocol/issues/2979)) ([749c793](https://github.com/UMAprotocol/protocol/commit/749c7930b8440f30390f0a577f39a47aa940f1cf))
- **package.json:** bump web3 to 1.3.5 ([#2982](https://github.com/UMAprotocol/protocol/issues/2982)) ([335d0d4](https://github.com/UMAprotocol/protocol/commit/335d0d47b4e1f90cd77ee28116f6d06da83e8865))
- **price-feeds:** allow for cryptowatch price inversion when twapLength is defined ([#2945](https://github.com/UMAprotocol/protocol/issues/2945)) ([5543a0f](https://github.com/UMAprotocol/protocol/commit/5543a0ffa01e66f43362cfede17763a59810a91d))
- **Trader:** Post wargames changes ([#2955](https://github.com/UMAprotocol/protocol/issues/2955)) ([4acb0ea](https://github.com/UMAprotocol/protocol/commit/4acb0eabdae1513a7841bd2d2d00d81a26a9e89b))

### Features

- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- **financial-templates-lib:** Add default price feed configs for XSUSHIUSD, BALUSD and uSTONKS_JUN21 ([#2876](https://github.com/UMAprotocol/protocol/issues/2876)) ([709f23a](https://github.com/UMAprotocol/protocol/commit/709f23a2b8827bcab8c849507ac799de0ffb01d1))
- **GasEstimator:** update the default to use fast gas price ([#2951](https://github.com/UMAprotocol/protocol/issues/2951)) ([4dc62cd](https://github.com/UMAprotocol/protocol/commit/4dc62cd1714cc1cee0781436cb4861660cb6dc55))
- **price-feed:** Add default pf configs for PUNKETH_TWAP and USDXIO ([#2975](https://github.com/UMAprotocol/protocol/issues/2975)) ([e09a013](https://github.com/UMAprotocol/protocol/commit/e09a013c721534c907d6d7dea562a05147635a1e))
- **price-feeds:** add uniswap v3 price feed ([#2918](https://github.com/UMAprotocol/protocol/issues/2918)) ([d87066c](https://github.com/UMAprotocol/protocol/commit/d87066cac46b72b3d1a5e4734d8a7536c6a93da8))
- **trader:** add uniswapv3 broker to trader ([#2942](https://github.com/UMAprotocol/protocol/issues/2942)) ([4612097](https://github.com/UMAprotocol/protocol/commit/4612097ead953b89daa6e237cdb6c704460025dd))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@2.1.0...@uma/financial-templates-lib@2.2.0) (2021-04-23)

### Bug Fixes

- **allowances:** Change default allowance value ([#2725](https://github.com/UMAprotocol/protocol/issues/2725)) ([94bcf9c](https://github.com/UMAprotocol/protocol/commit/94bcf9cba1cc258ac7f8536e12ddbbef37c9a4ce))
- **blockfinder:** Explicitly cast timestamp to Number ([#2880](https://github.com/UMAprotocol/protocol/issues/2880)) ([1d4924d](https://github.com/UMAprotocol/protocol/commit/1d4924d5f7b542cd582dafbf796dd7fd9c52b4f6))
- **FallBackPriceFeed:** implement missing method that broke in production ([#2878](https://github.com/UMAprotocol/protocol/issues/2878)) ([f5b87f6](https://github.com/UMAprotocol/protocol/commit/f5b87f6ef229ec5c2658dacd3bc5ab64c16976e0))
- **forex-daily-pricefeed:** Fix endpoint ([#2822](https://github.com/UMAprotocol/protocol/issues/2822)) ([fdbe7c9](https://github.com/UMAprotocol/protocol/commit/fdbe7c9a69e931bb689c93b5017c566377797bd3)), closes [#2821](https://github.com/UMAprotocol/protocol/issues/2821)
- **forexdaily-pricefeed:** Add apiKey config ([#2821](https://github.com/UMAprotocol/protocol/issues/2821)) ([f6436da](https://github.com/UMAprotocol/protocol/commit/f6436da84bbc034a27baca16fa1c18b935a1803e))
- **trader & atomic liquidator:** add wait for block to be mined util to address slow node updates ([#2871](https://github.com/UMAprotocol/protocol/issues/2871)) ([0106a8d](https://github.com/UMAprotocol/protocol/commit/0106a8dc22c26ee3d7aaf777ed12b6d894e88863))
- call update on gas estimator before sending transactions ([#2817](https://github.com/UMAprotocol/protocol/issues/2817)) ([8d0d14b](https://github.com/UMAprotocol/protocol/commit/8d0d14bbaf9724343a38ff1e1afc88ab5dfe6396))
- **liquidator:** should submit raw # of position tokens, not funding-rate adjusted # ([#2752](https://github.com/UMAprotocol/protocol/issues/2752)) ([53a1b28](https://github.com/UMAprotocol/protocol/commit/53a1b28d1118a01d713be0255485a8ef23e08999))

### Features

- **bot-strategy-runner:** add generalised bot runner ([#2851](https://github.com/UMAprotocol/protocol/issues/2851)) ([a748107](https://github.com/UMAprotocol/protocol/commit/a748107df25d153443caf82ec42c08c03ae23bfd))
- **fallback-pricefeed:** Create FallBackPriceFeed and ForexPriceFeed ([#2718](https://github.com/UMAprotocol/protocol/issues/2718)) ([be64c98](https://github.com/UMAprotocol/protocol/commit/be64c9872a1876d523f0f039dfc63d69b233533a))
- **financial-templates-lib:** Add default pf configs ([#2778](https://github.com/UMAprotocol/protocol/issues/2778)) ([8120982](https://github.com/UMAprotocol/protocol/commit/81209824fd9ad485843183e4ce59b1de0f5175be))
- **financial-templates-lib:** add DIGGBTC, DIGGETH, DIGGUSD default price feeds ([#2676](https://github.com/UMAprotocol/protocol/issues/2676)) ([b8ced4d](https://github.com/UMAprotocol/protocol/commit/b8ced4d366d28ac9a26cf4b1d832688f61ef2de1))
- **liquidation-reserve-currency:** add reserve currency liquidator to bots and refine smart contract ([#2775](https://github.com/UMAprotocol/protocol/issues/2775)) ([0eea3fb](https://github.com/UMAprotocol/protocol/commit/0eea3fbb610f74694c22ca36f6902faf3fa9092b))
- **multicall:** Using Multicall contract to simulate contract state post-state modifying transactions ([#2762](https://github.com/UMAprotocol/protocol/issues/2762)) ([fa8ee91](https://github.com/UMAprotocol/protocol/commit/fa8ee9146c2497c4e370f58a9eca2c7306337f9e))
- **price-feed:** Proposed dVIX Price Feed Interface ([#2792](https://github.com/UMAprotocol/protocol/issues/2792)) ([4224e05](https://github.com/UMAprotocol/protocol/commit/4224e05ffdd06f3b44fef0fb6019fcf4c0ff1bb5))
- **price-feeds:** add default ETH/BTC funding rate price feed ([#2814](https://github.com/UMAprotocol/protocol/issues/2814)) ([98a0236](https://github.com/UMAprotocol/protocol/commit/98a0236688b6aa9a3b011c110a428d1907f72b89))
- **price-feeds:** add funding rate multiplier price feed ([#2770](https://github.com/UMAprotocol/protocol/issues/2770)) ([e4ef9ac](https://github.com/UMAprotocol/protocol/commit/e4ef9ac030537488248a722f787f77186cef4ac1))
- **price-feeds:** add twap to cryptowatch ([#2772](https://github.com/UMAprotocol/protocol/issues/2772)) ([b2ce17e](https://github.com/UMAprotocol/protocol/commit/b2ce17ee2c5ec98485b1b3f66f197ad1dd7069fb))
- **pricefeed:** Add QuandlPriceFeed and use as backup for commodity identifiers ([#2728](https://github.com/UMAprotocol/protocol/issues/2728)) ([1d5de23](https://github.com/UMAprotocol/protocol/commit/1d5de230e50f559d8892b117b8278d79b8448b60))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/financial-templates-lib@2.0.1...@uma/financial-templates-lib@2.1.0) (2021-03-16)

### Bug Fixes

- **financial-templates-lib:** Change Basis configs to use median ([#2671](https://github.com/UMAprotocol/protocol/issues/2671)) ([85661e3](https://github.com/UMAprotocol/protocol/commit/85661e305e734dc6f0bce82af481682d3d7beeb3))
- **networker:** throw on error rather than logging an error ([#2696](https://github.com/UMAprotocol/protocol/issues/2696)) ([a6cb5c5](https://github.com/UMAprotocol/protocol/commit/a6cb5c568082565074f6edddc74efe2a97e5f755))
- correct PHPDAI default price feed config ([#2578](https://github.com/UMAprotocol/protocol/issues/2578)) ([bf168fa](https://github.com/UMAprotocol/protocol/commit/bf168fae3bb251adb1acee9bd918e7cd52bd61a0))

### Features

- **financial-templates-lib:** add uSTONKS default price feed ([#2637](https://github.com/UMAprotocol/protocol/issues/2637)) ([3d2eab4](https://github.com/UMAprotocol/protocol/commit/3d2eab49a3708bb8685d8352b920a194a38cac3c))
- **financial-templates-lib:** Add various altcoin price feed configs ([#2688](https://github.com/UMAprotocol/protocol/issues/2688)) ([41e7173](https://github.com/UMAprotocol/protocol/commit/41e717351bcdd6e42bdce53f8d7d31d5749c7e3f))
- **monitors:** Add FundingRateUpdate event messages to monitor ([#2664](https://github.com/UMAprotocol/protocol/issues/2664)) ([4a7afe8](https://github.com/UMAprotocol/protocol/commit/4a7afe81ac3131b63da9412e42900cf676a1f531))
- **optimistic-oracle-monitor:** Support OptimisticOracle event monitoring ([#2597](https://github.com/UMAprotocol/protocol/issues/2597)) ([49e34d2](https://github.com/UMAprotocol/protocol/commit/49e34d21b465547b271bb6fdfc15537ee9cf196f))
- **perpetual-proposer:** Initialize PerpetualFundingRateProposer package ([#2632](https://github.com/UMAprotocol/protocol/issues/2632)) ([42fe711](https://github.com/UMAprotocol/protocol/commit/42fe711788b2c95bef1be64c7c033e4bd1391e2a))
- **price-feed:** generalizes the DefiPulseTotalPriceFeed to work for individual DeFi projects ([#2655](https://github.com/UMAprotocol/protocol/issues/2655)) ([cadccb0](https://github.com/UMAprotocol/protocol/commit/cadccb00a7cf01a82c2e30b1b5af263876419793))
- **trader:** add Ranger Trader, Exchange Adapter and initial trader implementation ([#2579](https://github.com/UMAprotocol/protocol/issues/2579)) ([8bc3dad](https://github.com/UMAprotocol/protocol/commit/8bc3dad7f34abd805ce24638415cdd7cca6314ed))
- **trader+DSProxyManager:** Few small tweaks after war games + useful DSProxy token management script ([#2656](https://github.com/UMAprotocol/protocol/issues/2656)) ([684f78f](https://github.com/UMAprotocol/protocol/commit/684f78f09e284466fac74c7388cab56d56aadd4c))

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

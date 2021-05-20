# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@2.2.0...@uma/liquidator@2.3.0) (2021-05-20)

### Bug Fixes

- **ReserveCurrencyLiquidator:** improve how the contract handles reserve OR collateral currency shortfall ([#2896](https://github.com/UMAprotocol/protocol/issues/2896)) ([bfaf8e5](https://github.com/UMAprotocol/protocol/commit/bfaf8e53cfddce4463adf3751a1c999cfe361fd9))

### Features

- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- **disputer:** add single reserve currency disputer contracts to disputer ([#2976](https://github.com/UMAprotocol/protocol/issues/2976)) ([cfd4b43](https://github.com/UMAprotocol/protocol/commit/cfd4b4302c373c619d25cdb81443f4275d3ba2eb))
- **price-feeds:** add uniswap v3 price feed ([#2918](https://github.com/UMAprotocol/protocol/issues/2918)) ([d87066c](https://github.com/UMAprotocol/protocol/commit/d87066cac46b72b3d1a5e4734d8a7536c6a93da8))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@2.1.0...@uma/liquidator@2.2.0) (2021-04-23)

### Bug Fixes

- **liquidator:** address small issue in withdrawing legacy EMPs ([#2889](https://github.com/UMAprotocol/protocol/issues/2889)) ([87c4858](https://github.com/UMAprotocol/protocol/commit/87c4858e6f0fcd6d9fac750e7b41a52b77cc47fd))
- **liquidator:** should submit raw # of position tokens, not funding-rate adjusted # ([#2752](https://github.com/UMAprotocol/protocol/issues/2752)) ([53a1b28](https://github.com/UMAprotocol/protocol/commit/53a1b28d1118a01d713be0255485a8ef23e08999))
- **liquidator:** update DSProxy to deal with reserve currency matching collateral currency ([#2892](https://github.com/UMAprotocol/protocol/issues/2892)) ([a9a2af3](https://github.com/UMAprotocol/protocol/commit/a9a2af369f1a261d9de8a883eaf1b72e2637f8f7))
- **proxyTransactionWrapper:** Add runTransaction to Proxy Transaction wrapper ([#2870](https://github.com/UMAprotocol/protocol/issues/2870)) ([fc9a1a3](https://github.com/UMAprotocol/protocol/commit/fc9a1a36caf294bcd60841a14e00376cc5c715fc))
- **ProxyTransactionWrapper:** typecasting on balance in ProxyTransactionWrapper ([#2897](https://github.com/UMAprotocol/protocol/issues/2897)) ([f05b0ea](https://github.com/UMAprotocol/protocol/commit/f05b0ea4d33777507b489c65a09239133b1aa13d))
- **trader & atomic liquidator:** add wait for block to be mined util to address slow node updates ([#2871](https://github.com/UMAprotocol/protocol/issues/2871)) ([0106a8d](https://github.com/UMAprotocol/protocol/commit/0106a8dc22c26ee3d7aaf777ed12b6d894e88863))

### Features

- **bot-strategy-runner:** add generalised bot runner ([#2851](https://github.com/UMAprotocol/protocol/issues/2851)) ([a748107](https://github.com/UMAprotocol/protocol/commit/a748107df25d153443caf82ec42c08c03ae23bfd))
- **FindContractVersion:** update FindContractVersion to build contract hashes during core build process ([#2873](https://github.com/UMAprotocol/protocol/issues/2873)) ([4e5a3bd](https://github.com/UMAprotocol/protocol/commit/4e5a3bddfb90b2e868bbd04274947b5bcf0eebb9))
- **liquidation-reserve-currency:** add reserve currency liquidator to bots and refine smart contract ([#2775](https://github.com/UMAprotocol/protocol/issues/2775)) ([0eea3fb](https://github.com/UMAprotocol/protocol/commit/0eea3fbb610f74694c22ca36f6902faf3fa9092b))
- **liquidator:** remove one inch intergration ([#2756](https://github.com/UMAprotocol/protocol/issues/2756)) ([03e20c0](https://github.com/UMAprotocol/protocol/commit/03e20c09a6a2e1ced754507b64ebfb67ee812c75))
- **liquidator-contracts:** add atomic-liquidator contracts enabling Swap, mint, liquidate behaviour ([#2750](https://github.com/UMAprotocol/protocol/issues/2750)) ([602ced4](https://github.com/UMAprotocol/protocol/commit/602ced447486d1920667925e0eba80eb9bf79b74))
- **multicall:** Using Multicall contract to simulate contract state post-state modifying transactions ([#2762](https://github.com/UMAprotocol/protocol/issues/2762)) ([fa8ee91](https://github.com/UMAprotocol/protocol/commit/fa8ee9146c2497c4e370f58a9eca2c7306337f9e))
- **scripts:** improve scripts for running Kovan EMP war games ([#2605](https://github.com/UMAprotocol/protocol/issues/2605)) ([0ddb8db](https://github.com/UMAprotocol/protocol/commit/0ddb8db66af688b4ade346a6738aba49d766db81))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@2.0.1...@uma/liquidator@2.1.0) (2021-03-16)

### Features

- **perpetual-proposer:** Initialize PerpetualFundingRateProposer package ([#2632](https://github.com/UMAprotocol/protocol/issues/2632)) ([42fe711](https://github.com/UMAprotocol/protocol/commit/42fe711788b2c95bef1be64c7c033e4bd1391e2a))
- **trader+DSProxyManager:** Few small tweaks after war games + useful DSProxy token management script ([#2656](https://github.com/UMAprotocol/protocol/issues/2656)) ([684f78f](https://github.com/UMAprotocol/protocol/commit/684f78f09e284466fac74c7388cab56d56aadd4c))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@2.0.0...@uma/liquidator@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/liquidator

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@1.2.0...@uma/liquidator@2.0.0) (2021-02-26)

### Bug Fixes

- **FindContractVersion:** address web3.js inconsistant production behaviour with ethers.js ([#2477](https://github.com/UMAprotocol/protocol/issues/2477)) ([0ae44df](https://github.com/UMAprotocol/protocol/commit/0ae44dfa098fc9a7453906cf9130b47740e5ed75))
- **liquidator:** Remove unneccessary event query ([#2568](https://github.com/UMAprotocol/protocol/issues/2568)) ([4424206](https://github.com/UMAprotocol/protocol/commit/44242061e3d2b0c4cf63d0641c6c794cb7f3698c))
- **monitor,disputer,liquidator bots:** correctly pass in bot config objects into bots ([#2409](https://github.com/UMAprotocol/protocol/issues/2409)) ([d3c0ad4](https://github.com/UMAprotocol/protocol/commit/d3c0ad4b7b366596f2938ef4230eacf03d1aa8d5))
- **serverless-hub:** Address dropped spoke logs and mismatch timedout spokes ([#2514](https://github.com/UMAprotocol/protocol/issues/2514)) ([00914c0](https://github.com/UMAprotocol/protocol/commit/00914c082bb42778c836def883f95fe00f26a229))

### Features

- **bot-tests:** generalize muli-version testing ([#2448](https://github.com/UMAprotocol/protocol/issues/2448)) ([95fb302](https://github.com/UMAprotocol/protocol/commit/95fb302f5b370658adced9cf23c3f897fe00d7d5))
- **disputer:** add perp support to disputer ([#2453](https://github.com/UMAprotocol/protocol/issues/2453)) ([c79f347](https://github.com/UMAprotocol/protocol/commit/c79f3476fee07736257582f7d92eb7c95932c300))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **monitor:** add perp support to monitor ([#2475](https://github.com/UMAprotocol/protocol/issues/2475)) ([b24bae1](https://github.com/UMAprotocol/protocol/commit/b24bae1fc3aabb6b163043447dd9c5baa1d156b8))
- **yarn:** enable concurrency between test threads ([#2449](https://github.com/UMAprotocol/protocol/issues/2449)) ([b17b655](https://github.com/UMAprotocol/protocol/commit/b17b6558b714a9ac9f762dccdfa95764f9dfe1b9))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@1.1.0...@uma/liquidator@1.2.0) (2020-11-23)

### Features

- **emp:** financial product library to apply price transformation ([#2185](https://github.com/UMAprotocol/protocol/issues/2185)) ([5a7e2ec](https://github.com/UMAprotocol/protocol/commit/5a7e2ec25c5ecbc09397284839a553fee9d5636d))
- **liquidator:** adds in whale withdraw defense strategy ([#2063](https://github.com/UMAprotocol/protocol/issues/2063)) ([9ccfd3f](https://github.com/UMAprotocol/protocol/commit/9ccfd3f00fd962363214664e244e8227b4ebf2f8))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/liquidator@1.0.0...@uma/liquidator@1.1.0) (2020-10-05)

### Features

- **emp:** add trimExcess function to send excess tokens ([#1975](https://github.com/UMAprotocol/protocol/issues/1975)) ([658f4d9](https://github.com/UMAprotocol/protocol/commit/658f4d90cff9ece8b05a2922dcb0f78e9b62c80d))
- **liquidator:** disable 1inch functionality, warn user if they try to use it ([#2058](https://github.com/UMAprotocol/protocol/issues/2058)) ([3f31b2f](https://github.com/UMAprotocol/protocol/commit/3f31b2f624da0f26a8370e82ddc5ef2e867ee723))

# 1.0.0 (2020-09-15)

Initial Release!

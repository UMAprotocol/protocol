# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@2.2.0...@uma/disputer@2.3.0) (2021-05-20)

### Features

- **disputer:** Add dispute threshold ([#2997](https://github.com/UMAprotocol/protocol/issues/2997)) ([9a98afa](https://github.com/UMAprotocol/protocol/commit/9a98afaa57927842938e53799e98328a7c4d5dfb))
- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- **disputer:** add single reserve currency disputer contracts to disputer ([#2976](https://github.com/UMAprotocol/protocol/issues/2976)) ([cfd4b43](https://github.com/UMAprotocol/protocol/commit/cfd4b4302c373c619d25cdb81443f4275d3ba2eb))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@2.1.0...@uma/disputer@2.2.0) (2021-04-23)

### Features

- **bot-strategy-runner:** add generalised bot runner ([#2851](https://github.com/UMAprotocol/protocol/issues/2851)) ([a748107](https://github.com/UMAprotocol/protocol/commit/a748107df25d153443caf82ec42c08c03ae23bfd))
- **FindContractVersion:** update FindContractVersion to build contract hashes during core build process ([#2873](https://github.com/UMAprotocol/protocol/issues/2873)) ([4e5a3bd](https://github.com/UMAprotocol/protocol/commit/4e5a3bddfb90b2e868bbd04274947b5bcf0eebb9))
- **liquidation-reserve-currency:** add reserve currency liquidator to bots and refine smart contract ([#2775](https://github.com/UMAprotocol/protocol/issues/2775)) ([0eea3fb](https://github.com/UMAprotocol/protocol/commit/0eea3fbb610f74694c22ca36f6902faf3fa9092b))
- **multicall:** Using Multicall contract to simulate contract state post-state modifying transactions ([#2762](https://github.com/UMAprotocol/protocol/issues/2762)) ([fa8ee91](https://github.com/UMAprotocol/protocol/commit/fa8ee9146c2497c4e370f58a9eca2c7306337f9e))
- **run-transaction-helper:** Move ynatm functionality into runTransaction helper ([#2804](https://github.com/UMAprotocol/protocol/issues/2804)) ([cd3f3ef](https://github.com/UMAprotocol/protocol/commit/cd3f3ef0c96be742a2a585a957db2f884a234744))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@2.0.1...@uma/disputer@2.1.0) (2021-03-16)

### Features

- **perpetual-proposer:** Initialize PerpetualFundingRateProposer package ([#2632](https://github.com/UMAprotocol/protocol/issues/2632)) ([42fe711](https://github.com/UMAprotocol/protocol/commit/42fe711788b2c95bef1be64c7c033e4bd1391e2a))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@2.0.0...@uma/disputer@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/disputer

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@1.2.0...@uma/disputer@2.0.0) (2021-02-26)

### Bug Fixes

- **monitor,disputer,liquidator bots:** correctly pass in bot config objects into bots ([#2409](https://github.com/UMAprotocol/protocol/issues/2409)) ([d3c0ad4](https://github.com/UMAprotocol/protocol/commit/d3c0ad4b7b366596f2938ef4230eacf03d1aa8d5))
- **serverless-hub:** Address dropped spoke logs and mismatch timedout spokes ([#2514](https://github.com/UMAprotocol/protocol/issues/2514)) ([00914c0](https://github.com/UMAprotocol/protocol/commit/00914c082bb42778c836def883f95fe00f26a229))

### Features

- **disputer:** add perp support to disputer ([#2453](https://github.com/UMAprotocol/protocol/issues/2453)) ([c79f347](https://github.com/UMAprotocol/protocol/commit/c79f3476fee07736257582f7d92eb7c95932c300))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **financial-templates-lib:** make getHistoricalPrice async ([#2493](https://github.com/UMAprotocol/protocol/issues/2493)) ([c91e11b](https://github.com/UMAprotocol/protocol/commit/c91e11bad264509efd4ef98044e448e6e5b8b5f0))
- **yarn:** enable concurrency between test threads ([#2449](https://github.com/UMAprotocol/protocol/issues/2449)) ([b17b655](https://github.com/UMAprotocol/protocol/commit/b17b6558b714a9ac9f762dccdfa95764f9dfe1b9))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@1.1.0...@uma/disputer@1.2.0) (2020-11-23)

### Features

- **emp:** financial product library to apply price transformation ([#2185](https://github.com/UMAprotocol/protocol/issues/2185)) ([5a7e2ec](https://github.com/UMAprotocol/protocol/commit/5a7e2ec25c5ecbc09397284839a553fee9d5636d))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/disputer@1.0.0...@uma/disputer@1.1.0) (2020-10-05)

### Features

- **emp:** add trimExcess function to send excess tokens ([#1975](https://github.com/UMAprotocol/protocol/issues/1975)) ([658f4d9](https://github.com/UMAprotocol/protocol/commit/658f4d90cff9ece8b05a2922dcb0f78e9b62c80d))

# 1.0.0 (2020-09-15)

Initial Release!

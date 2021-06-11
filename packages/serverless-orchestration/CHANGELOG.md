# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/serverless-orchestration@2.1.0...@uma/serverless-orchestration@2.2.0) (2021-05-20)

### Bug Fixes

- **package.json:** bump web3 to 1.3.5 ([#2982](https://github.com/UMAprotocol/protocol/issues/2982)) ([335d0d4](https://github.com/UMAprotocol/protocol/commit/335d0d47b4e1f90cd77ee28116f6d06da83e8865))

### Features

- **core:** add typescript types for core ([#2927](https://github.com/UMAprotocol/protocol/issues/2927)) ([3ba662f](https://github.com/UMAprotocol/protocol/commit/3ba662f99bb9d1c33b207457ce9fa6cb90336d98))
- **core:** updated solidity version to 0.8.x ([#2924](https://github.com/UMAprotocol/protocol/issues/2924)) ([5db0d71](https://github.com/UMAprotocol/protocol/commit/5db0d7178cd6a3c807db4586eeb22a16229e9213))
- **liquidation-reporter:** Add excel spreadsheet generator that reports on collateral drawdown prices ([#2742](https://github.com/UMAprotocol/protocol/issues/2742)) ([0801022](https://github.com/UMAprotocol/protocol/commit/08010229505a643b048d472d2c409f4e03728487))
- **serverless:** make spoke stream stdout and stderr so hanging processes can be debugged ([#2902](https://github.com/UMAprotocol/protocol/issues/2902)) ([399628e](https://github.com/UMAprotocol/protocol/commit/399628e984296079a8b13a3700a918bea694c639))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/serverless-orchestration@2.0.1...@uma/serverless-orchestration@2.1.0) (2021-03-16)

### Features

- **optimistic-oracle-monitor:** Support OptimisticOracle event monitoring ([#2597](https://github.com/UMAprotocol/protocol/issues/2597)) ([49e34d2](https://github.com/UMAprotocol/protocol/commit/49e34d21b465547b271bb6fdfc15537ee9cf196f))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/serverless-orchestration@2.0.0...@uma/serverless-orchestration@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/serverless-orchestration

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/serverless-orchestration@1.1.0...@uma/serverless-orchestration@2.0.0) (2021-02-26)

### Bug Fixes

- **serverless-hub:** Address dropped spoke logs and mismatch timedout spokes ([#2514](https://github.com/UMAprotocol/protocol/issues/2514)) ([00914c0](https://github.com/UMAprotocol/protocol/commit/00914c082bb42778c836def883f95fe00f26a229))

### Features

- **2291:** set higher fromBlock for EMP client, and getFromBlock function for override ([#2360](https://github.com/UMAprotocol/protocol/issues/2360)) ([cb44b67](https://github.com/UMAprotocol/protocol/commit/cb44b67829c5887b10214405db00c19a91b89616))
- **disputer:** add perp support to disputer ([#2453](https://github.com/UMAprotocol/protocol/issues/2453)) ([c79f347](https://github.com/UMAprotocol/protocol/commit/c79f3476fee07736257582f7d92eb7c95932c300))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **monitor:** add perp support to monitor ([#2475](https://github.com/UMAprotocol/protocol/issues/2475)) ([b24bae1](https://github.com/UMAprotocol/protocol/commit/b24bae1fc3aabb6b163043447dd9c5baa1d156b8))
- **serverless:** add timeout delay to serverless spoke calls ([#2393](https://github.com/UMAprotocol/protocol/issues/2393)) ([68040c5](https://github.com/UMAprotocol/protocol/commit/68040c52c7aaff09223bc5b83e04ef8f2cc45b71))
- **serverless-hub:** add retry hub logic for rejected calls ([#2335](https://github.com/UMAprotocol/protocol/issues/2335)) ([de5629a](https://github.com/UMAprotocol/protocol/commit/de5629a8d16e64c3879d1d3b4c3472c64f4d9089))

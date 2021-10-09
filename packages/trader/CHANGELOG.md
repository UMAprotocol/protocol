# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.7.2](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.7.1...@uma/trader@1.7.2) (2021-10-08)

**Note:** Version bump only for package @uma/trader

## [1.7.1](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.7.0...@uma/trader@1.7.1) (2021-10-01)

**Note:** Version bump only for package @uma/trader

# [1.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.6.0...@uma/trader@1.7.0) (2021-10-01)

### Features

- **core:** move all active scripts out of core and deprecate rest ([#3397](https://github.com/UMAprotocol/protocol/issues/3397)) ([f96b8c9](https://github.com/UMAprotocol/protocol/commit/f96b8c90b01002594bf44ac44f03f6d021bee460))

# [1.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.5.3...@uma/trader@1.6.0) (2021-09-28)

### Bug Fixes

- **cross-package:** Fixed typo of "ballance"->"balance" in a few packages ([#3265](https://github.com/UMAprotocol/protocol/issues/3265)) ([f48cd48](https://github.com/UMAprotocol/protocol/commit/f48cd48f74aefec1b348f2d8ea1cf4e787810809))

### Features

- **core:** add tasks to manage artifacts and deployments ([#3229](https://github.com/UMAprotocol/protocol/issues/3229)) ([15a8f31](https://github.com/UMAprotocol/protocol/commit/15a8f31e3d3ce0df9b68b03ae56f8df789ae481a))
- **financial-templates-lib:** convert src to typescript ([#3315](https://github.com/UMAprotocol/protocol/issues/3315)) ([3955d80](https://github.com/UMAprotocol/protocol/commit/3955d80038df1c54663a59b44d6e23bd09c7dcdc))
- **liquidator,disputer,monitor:** remove unnecessary unit conversion helpers in tests ([#3215](https://github.com/UMAprotocol/protocol/issues/3215)) ([77993f4](https://github.com/UMAprotocol/protocol/commit/77993f4d8ffa5ba821f66d5ff5d7c0cac7813009))
- **trader:** migrate away from truffle ([#3346](https://github.com/UMAprotocol/protocol/issues/3346)) ([1fca526](https://github.com/UMAprotocol/protocol/commit/1fca52652a4995369bee2a89542f43396d502bd3))
- Upgrade hardhat to 2.5 to be compatible with London hardfork ([#3248](https://github.com/UMAprotocol/protocol/issues/3248)) ([b1524ce](https://github.com/UMAprotocol/protocol/commit/b1524ce868fc17c7486872a8ef632497f757288d))

## [1.5.3](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.5.2...@uma/trader@1.5.3) (2021-07-19)

**Note:** Version bump only for package @uma/trader

## [1.5.2](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.5.1...@uma/trader@1.5.2) (2021-07-15)

**Note:** Version bump only for package @uma/trader

## [1.5.1](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.5.0...@uma/trader@1.5.1) (2021-07-07)

**Note:** Version bump only for package @uma/trader

# [1.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.4.0...@uma/trader@1.5.0) (2021-06-21)

### Bug Fixes

- **common-ContractUtils:** Add web3 param injection to createContractObjectFromJson ([#3060](https://github.com/UMAprotocol/protocol/issues/3060)) ([805003a](https://github.com/UMAprotocol/protocol/commit/805003a94c01f2d8fb4556701382b0f4bbf26cd8))

### Features

- **run-transaction:** add multi EOA transaction runner to DSProxy bots ([#2961](https://github.com/UMAprotocol/protocol/issues/2961)) ([ab88497](https://github.com/UMAprotocol/protocol/commit/ab88497f180d72f1d9e8305fdeabf786f5883b7c))

# [1.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.3.0...@uma/trader@1.4.0) (2021-05-20)

### Bug Fixes

- **Trader:** Post wargames changes ([#2955](https://github.com/UMAprotocol/protocol/issues/2955)) ([4acb0ea](https://github.com/UMAprotocol/protocol/commit/4acb0eabdae1513a7841bd2d2d00d81a26a9e89b))

### Features

- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- **price-feeds:** add uniswap v3 price feed ([#2918](https://github.com/UMAprotocol/protocol/issues/2918)) ([d87066c](https://github.com/UMAprotocol/protocol/commit/d87066cac46b72b3d1a5e4734d8a7536c6a93da8))
- **trader:** add uniswapv3 broker to trader ([#2942](https://github.com/UMAprotocol/protocol/issues/2942)) ([4612097](https://github.com/UMAprotocol/protocol/commit/4612097ead953b89daa6e237cdb6c704460025dd))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.2.0...@uma/trader@1.3.0) (2021-04-23)

### Bug Fixes

- **trader:** pass along range trader config from env variables ([#2818](https://github.com/UMAprotocol/protocol/issues/2818)) ([10c4fac](https://github.com/UMAprotocol/protocol/commit/10c4fac62e96fd6d46228d8683da28e9b21cc079))
- **trader & atomic liquidator:** add wait for block to be mined util to address slow node updates ([#2871](https://github.com/UMAprotocol/protocol/issues/2871)) ([0106a8d](https://github.com/UMAprotocol/protocol/commit/0106a8dc22c26ee3d7aaf777ed12b6d894e88863))

### Features

- **action-wrappers:** Add a simple contract and script to enable DSProxy token redemtion ([#2808](https://github.com/UMAprotocol/protocol/issues/2808)) ([84d1989](https://github.com/UMAprotocol/protocol/commit/84d1989f6cb4f6360ce00e9a40fb57f163ce575e))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.1.1...@uma/trader@1.2.0) (2021-03-16)

### Features

- **trader:** add Ranger Trader, Exchange Adapter and initial trader implementation ([#2579](https://github.com/UMAprotocol/protocol/issues/2579)) ([8bc3dad](https://github.com/UMAprotocol/protocol/commit/8bc3dad7f34abd805ce24638415cdd7cca6314ed))
- **trader+DSProxyManager:** Few small tweaks after war games + useful DSProxy token management script ([#2656](https://github.com/UMAprotocol/protocol/issues/2656)) ([684f78f](https://github.com/UMAprotocol/protocol/commit/684f78f09e284466fac74c7388cab56d56aadd4c))

## [1.1.1](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.1.0...@uma/trader@1.1.1) (2021-02-27)

**Note:** Version bump only for package @uma/trader

# [1.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/trader@1.0.0...@uma/trader@1.1.0) (2021-02-26)

### Features

- **bot-infrastructure:** add a generic DSProxy client ([#2559](https://github.com/UMAprotocol/protocol/issues/2559)) ([b275463](https://github.com/UMAprotocol/protocol/commit/b275463c0bfe2c3a45a5c049534b5acc3df58688))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **optimistic-oracle-keeper:** Add functionality to propose prices for price requests ([#2505](https://github.com/UMAprotocol/protocol/issues/2505)) ([cc71ea5](https://github.com/UMAprotocol/protocol/commit/cc71ea56ef6fd944232f9e8f6a7e190ce2ab250d))

# 1.0.0 (2020-01-23)

Initial Release!

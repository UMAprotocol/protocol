# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/optimistic-oracle@2.2.0...@uma/optimistic-oracle@2.3.0) (2021-05-20)

### Bug Fixes

- **optimistic-oracle-disputer:** Ignore blacklisted identifiers ([#2925](https://github.com/UMAprotocol/protocol/issues/2925)) ([a0c866e](https://github.com/UMAprotocol/protocol/commit/a0c866edc055e435fa8ee1fd4777e86f4849f7ca))

### Features

- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/optimistic-oracle@2.1.0...@uma/optimistic-oracle@2.2.0) (2021-04-23)

### Bug Fixes

- **proposer:** cast timestamps to number when requesting historical price ([#2836](https://github.com/UMAprotocol/protocol/issues/2836)) ([752a403](https://github.com/UMAprotocol/protocol/commit/752a403506bc168ee368b323f213caaa6e62d560))

### Features

- **optimistic-oracle-proposer:** Blacklist identifiers to skip post-expiry ([#2826](https://github.com/UMAprotocol/protocol/issues/2826)) ([0de392f](https://github.com/UMAprotocol/protocol/commit/0de392f18bf0f3e5019c118996ebca771ebb2aa7))
- **run-transaction-helper:** Move ynatm functionality into runTransaction helper ([#2804](https://github.com/UMAprotocol/protocol/issues/2804)) ([cd3f3ef](https://github.com/UMAprotocol/protocol/commit/cd3f3ef0c96be742a2a585a957db2f884a234744))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/optimistic-oracle@2.0.1...@uma/optimistic-oracle@2.1.0) (2021-03-16)

### Features

- **optimistic-oracle-monitor:** Support OptimisticOracle event monitoring ([#2597](https://github.com/UMAprotocol/protocol/issues/2597)) ([49e34d2](https://github.com/UMAprotocol/protocol/commit/49e34d21b465547b271bb6fdfc15537ee9cf196f))
- **perpetual-proposer:** Initialize PerpetualFundingRateProposer package ([#2632](https://github.com/UMAprotocol/protocol/issues/2632)) ([42fe711](https://github.com/UMAprotocol/protocol/commit/42fe711788b2c95bef1be64c7c033e4bd1391e2a))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/optimistic-oracle@2.0.0...@uma/optimistic-oracle@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/optimistic-oracle

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/optimistic-oracle@1.0.0...@uma/optimistic-oracle@1.1.0) (2021-02-26)

### Features

- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **optimistic-oracle-keeper:** Add functionality to propose prices for price requests ([#2505](https://github.com/UMAprotocol/protocol/issues/2505)) ([cc71ea5](https://github.com/UMAprotocol/protocol/commit/cc71ea56ef6fd944232f9e8f6a7e190ce2ab250d))
- **optimistic-oracle-proposer:** Add DEBUG log about skipping dispute ([#2577](https://github.com/UMAprotocol/protocol/issues/2577)) ([c12d6c1](https://github.com/UMAprotocol/protocol/commit/c12d6c1c1de34de3ca6f5ef1f27e63e9e3040760))
- **optimistic-oracle-proposer:** Add dispute logic ([#2546](https://github.com/UMAprotocol/protocol/issues/2546)) ([8ef696e](https://github.com/UMAprotocol/protocol/commit/8ef696e2b02744a820893a3c646e47496488bdfd))
- **optimistic-oracle-proposer:** Can settle proposals and disputes ([#2569](https://github.com/UMAprotocol/protocol/issues/2569)) ([43a5b63](https://github.com/UMAprotocol/protocol/commit/43a5b637291c6352fb39c969a9cb13f73c34b65d))
- **optimistic-oracle-proposer:** Only submit disputes where historical prices diverge beyond a margin of allowed error ([#2564](https://github.com/UMAprotocol/protocol/issues/2564)) ([3a342da](https://github.com/UMAprotocol/protocol/commit/3a342da1b537f24007e092ec60fbeffcf09d0b50))
- **yarn:** enable concurrency between test threads ([#2449](https://github.com/UMAprotocol/protocol/issues/2449)) ([b17b655](https://github.com/UMAprotocol/protocol/commit/b17b6558b714a9ac9f762dccdfa95764f9dfe1b9))

# 1.0.0 (2020-12-21)

Initial Release!

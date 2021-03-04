# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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

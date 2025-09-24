# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.3.3](https://github.com/UMAprotocol/protocol/compare/@uma/logger@1.3.2...@uma/logger@1.3.3) (2025-09-24)

**Note:** Version bump only for package @uma/logger

## [1.3.2](https://github.com/UMAprotocol/protocol/compare/@uma/logger@1.3.1...@uma/logger@1.3.2) (2025-09-23)

### Bug Fixes

- **logger:** use rest for discord ticket transport ([#4872](https://github.com/UMAprotocol/protocol/issues/4872)) ([bd3abcd](https://github.com/UMAprotocol/protocol/commit/bd3abcd5291c5e872614106f4db8f2949576c7e8))
- enforce global rate limit in log queue transports ([#4870](https://github.com/UMAprotocol/protocol/issues/4870)) ([bbd8e92](https://github.com/UMAprotocol/protocol/commit/bbd8e921cd902749b4798dd72d38067512f0925c))
- rate limit discord tickets to 20 seconds ([#4866](https://github.com/UMAprotocol/protocol/issues/4866)) ([9f3b9a7](https://github.com/UMAprotocol/protocol/commit/9f3b9a7576472cb3d63a651db7e875313ba6741d))
- shared log queue in persistent queue transports ([#4869](https://github.com/UMAprotocol/protocol/issues/4869)) ([b38c56c](https://github.com/UMAprotocol/protocol/commit/b38c56cddf20551a557442a89109e1ee7f5da8e7))

## [1.3.1](https://github.com/UMAprotocol/protocol/compare/@uma/logger@1.3.0...@uma/logger@1.3.1) (2025-07-15)

**Note:** Version bump only for package @uma/logger

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/logger@1.2.0...@uma/logger@1.3.0) (2024-07-20)

### Features

- filter warnings from PD ([#4771](https://github.com/UMAprotocol/protocol/issues/4771)) ([f72d0b7](https://github.com/UMAprotocol/protocol/commit/f72d0b78c8892d97b97b4ef2d2f685e360dc5831))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/logger@1.1.0...@uma/logger@1.2.0) (2024-04-30)

### Bug Fixes

- emit redis errors to console rather than sending a logger error ([#4749](https://github.com/UMAprotocol/protocol/issues/4749)) ([7295bae](https://github.com/UMAprotocol/protocol/commit/7295baea133912c15f2a82d229d5f4490a808d21))
- pause persistent log queue after flush timeout ([#4751](https://github.com/UMAprotocol/protocol/issues/4751)) ([885513e](https://github.com/UMAprotocol/protocol/commit/885513e4cdccddff735fe25819efa9078e7ed408))
- revert use persistent log queue for discord tickets ([#4738](https://github.com/UMAprotocol/protocol/issues/4738)) ([5e63f82](https://github.com/UMAprotocol/protocol/commit/5e63f82ad1783d4f9489dd1761ce6a641137f97c))
- use persistent log queue for discord tickets ([#4734](https://github.com/UMAprotocol/protocol/issues/4734)) ([932bbed](https://github.com/UMAprotocol/protocol/commit/932bbed4a2cab4d9234bde5af9c02aaa260c4132))
- use redis log queue for discord tickets ([#4746](https://github.com/UMAprotocol/protocol/issues/4746)) ([8b303de](https://github.com/UMAprotocol/protocol/commit/8b303de834704a9036525f83c7b7bf4796901fb2))

### Features

- add run identifier in logger and hub/spoke ([#4745](https://github.com/UMAprotocol/protocol/issues/4745)) ([fbbc3a6](https://github.com/UMAprotocol/protocol/commit/fbbc3a6d0f2c755b1b54784c9a083b022b005503))

# 1.1.0 (2023-11-13)

### Features

- add logger package ([#4663](https://github.com/UMAprotocol/protocol/issues/4663)) ([2312ef6](https://github.com/UMAprotocol/protocol/commit/2312ef6b8845bb0dac5ed02b134ff6763b81a60d))

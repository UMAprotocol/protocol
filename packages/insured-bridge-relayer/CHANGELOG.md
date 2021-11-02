# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.6.0...@uma/insured-bridge-relayer@1.7.0) (2021-10-29)

### Bug Fixes

- **GasEstimator:** protocol upgrade for EIP1559 ([#3306](https://github.com/UMAprotocol/protocol/issues/3306)) ([8245391](https://github.com/UMAprotocol/protocol/commit/8245391ee07dca37be3c52a9a9ba47ed4d63f6f7))
- **insured-bridge-relayer:** Dispute any relay with non-whitelisted chain ID even if not using same chain ID as L2 client ([#3511](https://github.com/UMAprotocol/protocol/issues/3511)) ([557aeb9](https://github.com/UMAprotocol/protocol/commit/557aeb94cead79854ffc49b56dcab0cd52c39b48))
- **insured-bridge-relayer:** Handle case where computing realized LP fee % fails ([#3504](https://github.com/UMAprotocol/protocol/issues/3504)) ([9c69a9d](https://github.com/UMAprotocol/protocol/commit/9c69a9d3f545741820fbf73d5436b7f9f30aa8e0))
- **insured-bridge-relayer:** Key deposits by deposit hash instead of deposit ID ([#3510](https://github.com/UMAprotocol/protocol/issues/3510)) ([d75c342](https://github.com/UMAprotocol/protocol/commit/d75c34279c89f8d880416ef765cd36c0dc9b97b5))

### Features

- **create-price-feed:** Add InsuredBridge ([#3388](https://github.com/UMAprotocol/protocol/issues/3388)) ([4dd8116](https://github.com/UMAprotocol/protocol/commit/4dd811635fd5647bf5916eb366daf5d613f3856c))

# [1.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.5.0...@uma/insured-bridge-relayer@1.6.0) (2021-10-27)

### Bug Fixes

- **insured-bridge-relayer:** Do not fetch l1Token from DepositRelayed log ([#3505](https://github.com/UMAprotocol/protocol/issues/3505)) ([8e5ab9e](https://github.com/UMAprotocol/protocol/commit/8e5ab9e8d120e689197157ac576d535a24e443b5))
- **insured-bridge-relayer:** Fix usage of Logger ([#3483](https://github.com/UMAprotocol/protocol/issues/3483)) ([09c9b72](https://github.com/UMAprotocol/protocol/commit/09c9b720cdb9feb956ba4201f530a5134b4a235f))

### Features

- **across:** Add Disputer mode to bot ([#3474](https://github.com/UMAprotocol/protocol/issues/3474)) ([e2e8c6b](https://github.com/UMAprotocol/protocol/commit/e2e8c6bf1ee7432dc7dfe951f4de7ec95f3e1f2d))

# [1.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.4.0...@uma/insured-bridge-relayer@1.5.0) (2021-10-19)

### Features

- **across-bots:** add ability for relayer bot to finalize relays ([#3464](https://github.com/UMAprotocol/protocol/issues/3464)) ([0f9c26d](https://github.com/UMAprotocol/protocol/commit/0f9c26d8bda06aac0d08b5797e0bec2f2168c015))
- **insured-bridge:** Block instant relays post-expiry and change relayDeposit interface to match relayAndSpeedUp ([#3458](https://github.com/UMAprotocol/protocol/issues/3458)) ([25ac3c0](https://github.com/UMAprotocol/protocol/commit/25ac3c00be8afb33a6c6e134509f068699591025))
- **insured-bridge:** Update Arbitrum messenger contracts after e2e tests ([#3448](https://github.com/UMAprotocol/protocol/issues/3448)) ([fd2f9c5](https://github.com/UMAprotocol/protocol/commit/fd2f9c5976300cd3c82801884ef14abf890e1461))

# [1.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.3.0...@uma/insured-bridge-relayer@1.4.0) (2021-10-08)

### Bug Fixes

- **insured-bridge:** fix whitelist to work with multiple L2 chains ([#3436](https://github.com/UMAprotocol/protocol/issues/3436)) ([58f727e](https://github.com/UMAprotocol/protocol/commit/58f727e2cb96fa828385835e562f691d7c4fd6e3))
- **insured-bridge:** Instant relayer should only receive refund iff they sped up valid relay ([#3425](https://github.com/UMAprotocol/protocol/issues/3425)) ([27d3634](https://github.com/UMAprotocol/protocol/commit/27d3634c6fbe9cf1eb8419641d0dbddf9cb56569))

### Features

- **insured-bridge:** add Eth->Weth support on deposits and withdraws ([#3440](https://github.com/UMAprotocol/protocol/issues/3440)) ([33d01d4](https://github.com/UMAprotocol/protocol/commit/33d01d471437e1ab6861e4545ea4bb3895fd4d74))
- **insured-bridge:** Integrate SkinnyOptimisticOracle with BridgePool ([#3430](https://github.com/UMAprotocol/protocol/issues/3430)) ([554641c](https://github.com/UMAprotocol/protocol/commit/554641c25d79c4331e08a757f000621d55fe2675))
- **insured-bridge:** Reduce function gas costs by storing hash of Relay params instead of full struct ([#3438](https://github.com/UMAprotocol/protocol/issues/3438)) ([ff231b4](https://github.com/UMAprotocol/protocol/commit/ff231b4df83ede216c0cb431d32e6920b36aec7d))

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.2.0...@uma/insured-bridge-relayer@1.3.0) (2021-10-01)

### Features

- **insured-bridge:** War games 1 ([#3399](https://github.com/UMAprotocol/protocol/issues/3399)) ([8773494](https://github.com/UMAprotocol/protocol/commit/8773494d29cf0428ca6d65f0272b135ba3dafcbf))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.1.0...@uma/insured-bridge-relayer@1.2.0) (2021-10-01)

### Features

- **insured-bridge:** Remove deposit contract from relay params ([#3401](https://github.com/UMAprotocol/protocol/issues/3401)) ([c607211](https://github.com/UMAprotocol/protocol/commit/c607211b0cf0653ad5bb128042515b27efa492a3))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.0.0...@uma/insured-bridge-relayer@1.1.0) (2021-09-28)

### Features

- **insured-bridge:** Add ArbitrumMessenger ([#3392](https://github.com/UMAprotocol/protocol/issues/3392)) ([fa56d3c](https://github.com/UMAprotocol/protocol/commit/fa56d3c02c40fc72fe2288a286ea7849f14754f2))
- **insured-bridge:** Add realized LP fee pct computation ([#3373](https://github.com/UMAprotocol/protocol/issues/3373)) ([95abd8d](https://github.com/UMAprotocol/protocol/commit/95abd8d2d6e481a54e234bda6c7f8585babaa5eb))
- **insured-bridge:** BridgeAdmin supports multiple L2s ([#3390](https://github.com/UMAprotocol/protocol/issues/3390)) ([96cb0a4](https://github.com/UMAprotocol/protocol/commit/96cb0a4afd9b2f78a44d2cb481ec25c6e069cf58))
- **insured-bridge:** Modify relay ancillary data to enhance off-chain bots ([#3363](https://github.com/UMAprotocol/protocol/issues/3363)) ([1c2ea19](https://github.com/UMAprotocol/protocol/commit/1c2ea19af1d586c79ba0fe51a7be6cdbd25bea7c))
- **insured-bridge:** Refactoring for gas savings ([#3369](https://github.com/UMAprotocol/protocol/issues/3369)) ([1568cd9](https://github.com/UMAprotocol/protocol/commit/1568cd91406f38f8b69ba48753f1a7d094b8ea18))
- **insured-bridge-bot:** instant relay logic ([#3364](https://github.com/UMAprotocol/protocol/issues/3364)) ([65600ae](https://github.com/UMAprotocol/protocol/commit/65600aec5f53ae17792b4191a8dd03a03deceba7))
- **insured-bridge-relayer:** Add additional relay logic, should relay and slow relay implementation ([#3359](https://github.com/UMAprotocol/protocol/issues/3359)) ([2a81888](https://github.com/UMAprotocol/protocol/commit/2a81888934594815a5d85a7358c357397083ea23))
- **insured-bridge-relayer:** add speed up bridging and additional standardization ([#3362](https://github.com/UMAprotocol/protocol/issues/3362)) ([dfb578a](https://github.com/UMAprotocol/protocol/commit/dfb578a1008a4954534fa87b3f7752ef3c8fa9b1))
- **insured-bridge-relayer:** initial relayer logic implementation ([#3351](https://github.com/UMAprotocol/protocol/issues/3351)) ([a350bd9](https://github.com/UMAprotocol/protocol/commit/a350bd9d1fc9a8c58b4a57f58fee62e7cfd75141))
- **insured-bridge-relayer:** Stub imports of L1 and L2 Bridge clients ([#3333](https://github.com/UMAprotocol/protocol/issues/3333)) ([1cf7925](https://github.com/UMAprotocol/protocol/commit/1cf792523acf9393b352df25d0428f48c22e31f1))
